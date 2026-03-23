/*
  The loop node has controllable width and height properties, which serve as the parent node of loopFlow.
  When the childNodes of loopFlow change, it automatically calculates the rectangular width, height, and position of the childNodes, 
  thereby further updating the width and height properties of the loop node.
*/
import { type FlowNodeItemType } from '@fastgpt/global/core/workflow/type/node';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type NodeProps } from 'reactflow';
import NodeCard from '../render/NodeCard';
import Container from '../../components/Container';
import IOTitle from '../../components/IOTitle';
import { useTranslation } from 'next-i18next';
import { Box, Flex } from '@chakra-ui/react';
import FormLabel from '@fastgpt/web/components/common/MyBox/FormLabel';
import {
  ArrayTypeMap,
  NodeInputKeyEnum,
  NodeOutputKeyEnum,
  VARIABLE_NODE_ID,
  WorkflowIOValueTypeEnum
} from '@fastgpt/global/core/workflow/constants';
import {
  Input_Template_Children_Node_List,
  Input_Template_LOOP_NODE_OFFSET
} from '@fastgpt/global/core/workflow/template/input';
import { useContextSelector } from 'use-context-selector';
import { WorkflowBufferDataContext } from '../../../context/workflowInitContext';
import { getWorkflowGlobalVariables } from '@/web/core/workflow/utils';
import { AppContext } from '../../../../context';
import {
  isValidArrayReferenceValue,
  batchLoopMaxRetryTimes,
  normalizeBatchLoopErrorConfig
} from '@fastgpt/global/core/workflow/utils';
import {
  type FlowNodeInputItemType,
  type ReferenceArrayValueType,
  type ReferenceItemValueType
} from '@fastgpt/global/core/workflow/type/io';
import { WorkflowActionsContext } from '../../../context/workflowActionsContext';
import { WorkflowLayoutContext } from '../../../context/workflowComputeContext';
import { useMemoEnhance } from '@fastgpt/web/hooks/useMemoEnhance';
import QuestionTip from '@fastgpt/web/components/common/MyTooltip/QuestionTip';
import ValueTypeLabel from '../render/ValueTypeLabel';
import { ReferSelector, useReference } from '../render/RenderInput/templates/Reference';
import MyNumberInput from '@fastgpt/web/components/common/Input/NumberInput';
import RenderOutput from '../render/RenderOutput';

/** 监听 ref 元素尺寸，供循环节点输入区高度同步到节点配置 */
function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState<{ width: number; height: number }>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) => {
        if (prev && prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

const NodeLoop = ({ data, selected }: NodeProps<FlowNodeItemType>) => {
  const { t } = useTranslation();
  const { nodeId, inputs, outputs, isFolded } = data;
  const { getNodeById, nodeIds, nodeAmount, getNodeList, systemConfigNode } = useContextSelector(
    WorkflowBufferDataContext,
    (v) => v
  );
  const onChangeNode = useContextSelector(WorkflowActionsContext, (v) => v.onChangeNode);
  const appDetail = useContextSelector(AppContext, (v) => v.appDetail);
  const resetParentNodeSizeAndPosition = useContextSelector(
    WorkflowLayoutContext,
    (v) => v.resetParentNodeSizeAndPosition
  );
  const computedResult = useMemoEnhance(() => {
    return {
      nodeWidth: Math.round(
        Number(inputs.find((input) => input.key === NodeInputKeyEnum.nodeWidth)?.value) || 500
      ),
      nodeHeight: Math.round(
        Number(inputs.find((input) => input.key === NodeInputKeyEnum.nodeHeight)?.value) || 500
      ),
      loopInputArray: inputs.find((input) => input.key === NodeInputKeyEnum.loopInputArray),
      loopParallelLimit: inputs.find((input) => input.key === NodeInputKeyEnum.loopParallelLimit),
      loopErrorConfig: inputs.find((input) => input.key === NodeInputKeyEnum.loopErrorConfig),
      loopNodeInputHeight: inputs.find(
        (input) => input.key === NodeInputKeyEnum.loopNodeInputHeight
      )
    };
  }, [inputs]);
  const nodeWidth = computedResult.nodeWidth;
  const nodeHeight = computedResult.nodeHeight;
  const loopInputArray = useMemoEnhance(
    () => computedResult.loopInputArray,
    [computedResult.loopInputArray]
  );
  const loopParallelLimit = useMemoEnhance(
    () => computedResult.loopParallelLimit,
    [computedResult.loopParallelLimit]
  );
  const loopErrorConfig = useMemoEnhance(
    () => computedResult.loopErrorConfig,
    [computedResult.loopErrorConfig]
  );
  const loopNodeInputHeight = computedResult.loopNodeInputHeight ?? Input_Template_LOOP_NODE_OFFSET;
  const currentLoopErrorConfig = normalizeBatchLoopErrorConfig(loopErrorConfig?.value);
  const { referenceList: loopInputArrayReferenceList } = useReference({
    nodeId,
    valueType: loopInputArray?.valueType
  });

  // Update array input type
  // Computed the reference value type
  const newValueType = useMemo(() => {
    if (!loopInputArray) return WorkflowIOValueTypeEnum.arrayAny;
    const value = loopInputArray.value as ReferenceArrayValueType;

    if (!value || value.length === 0 || !isValidArrayReferenceValue(value, nodeIds))
      return WorkflowIOValueTypeEnum.arrayAny;

    const globalVariables = getWorkflowGlobalVariables({
      systemConfigNode,
      chatConfig: appDetail.chatConfig
    });

    const valueType = ((value) => {
      if (value?.[0] === VARIABLE_NODE_ID) {
        return globalVariables.find((item) => item.key === value[1])?.valueType;
      } else {
        const node = getNodeById(value?.[0]);
        const output = node?.outputs.find((output) => output.id === value?.[1]);
        return output?.valueType;
      }
    })(value[0]);
    return ArrayTypeMap[valueType as keyof typeof ArrayTypeMap] ?? WorkflowIOValueTypeEnum.arrayAny;
  }, [appDetail.chatConfig, getNodeById, loopInputArray, nodeIds, systemConfigNode]);
  useEffect(() => {
    if (!loopInputArray) return;
    onChangeNode({
      nodeId,
      type: 'updateInput',
      key: NodeInputKeyEnum.loopInputArray,
      value: {
        ...loopInputArray,
        valueType: newValueType
      }
    });
  }, [loopInputArray, newValueType, nodeId, onChangeNode]);

  // Update childrenNodeIdList
  const childrenNodeIdList = useMemoEnhance(() => {
    return getNodeList()
      .filter((node) => node.parentNodeId === nodeId)
      .map((node) => node.nodeId);
  }, [nodeId, getNodeList, nodeAmount]);
  useEffect(() => {
    onChangeNode({
      nodeId,
      type: 'updateInput',
      key: NodeInputKeyEnum.childrenNodeIdList,
      value: {
        ...Input_Template_Children_Node_List,
        value: childrenNodeIdList
      }
    });
    resetParentNodeSizeAndPosition(nodeId);
  }, [childrenNodeIdList, nodeId, onChangeNode, resetParentNodeSizeAndPosition]);

  // Update loop node offset value
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(inputBoxRef);
  useEffect(() => {
    if (!size?.height) return;

    onChangeNode({
      nodeId,
      type: 'replaceInput',
      key: NodeInputKeyEnum.loopNodeInputHeight,
      value: {
        ...loopNodeInputHeight,
        value: size.height
      }
    });

    setTimeout(() => {
      resetParentNodeSizeAndPosition(nodeId);
    }, 50);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.height]);

  const onChangeInput = (input: FlowNodeInputItemType, value: any) => {
    onChangeNode({
      nodeId,
      type: 'updateInput',
      key: input.key,
      value: {
        ...input,
        value
      }
    });
  };

  return (
    <NodeCard selected={selected} maxW="full" menuForbid={{ copy: true }} {...data}>
      <Container position={'relative'} flex={1}>
        <IOTitle text={t('common:Input')} />

        <Box ref={inputBoxRef} mb={6}>
          {loopInputArray && (
            <Box mb={4} maxW={'460px'}>
              <InputRowLabel input={loopInputArray} nodeId={nodeId} />
              <Box mt={2} className="nodrag">
                <ReferSelector
                  placeholder={t('common:select_reference_variable')}
                  list={loopInputArrayReferenceList}
                  value={loopInputArray.value as ReferenceArrayValueType}
                  onSelect={(value) => onChangeInput(loopInputArray, value)}
                  popDirection="top"
                  isArray
                  ButtonProps={{
                    h: '40px',
                    minH: '40px',
                    bg: 'white',
                    border: '1px solid',
                    borderColor: 'myGray.200',
                    borderRadius: '6px',
                    px: 3,
                    _hover: {
                      borderColor: 'myGray.300'
                    }
                  }}
                />
              </Box>
            </Box>
          )}

          {loopParallelLimit && (
            <Box mb={4} maxW={'460px'}>
              <InputRowLabel input={loopParallelLimit} nodeId={nodeId} showValueType={false} />
              <Box mt={2} className="nodrag">
                <MyNumberInput
                  value={Number(loopParallelLimit.value ?? 10)}
                  min={1}
                  max={50}
                  h={10}
                  w={'full'}
                  bg={'white'}
                  borderRadius={'6px'}
                  inputFieldProps={{
                    bg: 'white',
                    borderColor: 'myGray.200',
                    borderRadius: '6px',
                    fontSize: 'sm',
                    _hover: {
                      borderColor: 'myGray.300'
                    }
                  }}
                  onChange={(value) => onChangeInput(loopParallelLimit, value)}
                  onBlur={(value) => onChangeInput(loopParallelLimit, value)}
                />
              </Box>
            </Box>
          )}

          {loopErrorConfig && (
            <Box mb={4} maxW={'460px'}>
              <Flex alignItems={'center'} gap={2} mb={2}>
                <Box className="nodrag" color={'myGray.700'} fontSize={'sm'} fontWeight={'medium'}>
                  {t('workflow:loop_retry_times')}
                </Box>
              </Flex>
              <Box mt={2} className="nodrag">
                <MyNumberInput
                  value={Number(currentLoopErrorConfig.retryTimes ?? 3)}
                  min={0}
                  max={batchLoopMaxRetryTimes}
                  h={10}
                  w={'full'}
                  bg={'white'}
                  borderRadius={'6px'}
                  inputFieldProps={{
                    bg: 'white',
                    borderColor: 'myGray.200',
                    borderRadius: '6px',
                    fontSize: 'sm',
                    _hover: {
                      borderColor: 'myGray.300'
                    }
                  }}
                  onChange={(value) => {
                    if (!loopErrorConfig) return;
                    if (value === '') return;
                    const nextValue = Number(value);
                    const retryTimes = Number.isFinite(nextValue)
                      ? Math.min(batchLoopMaxRetryTimes, Math.max(0, Math.round(nextValue)))
                      : currentLoopErrorConfig.retryTimes;
                    onChangeInput(loopErrorConfig, { ...currentLoopErrorConfig, retryTimes });
                  }}
                  onBlur={(value) => {
                    if (!loopErrorConfig) return;
                    if (value === '') return;
                    const nextValue = Number(value);
                    const retryTimes = Number.isFinite(nextValue)
                      ? Math.min(batchLoopMaxRetryTimes, Math.max(0, Math.round(nextValue)))
                      : currentLoopErrorConfig.retryTimes;
                    onChangeInput(loopErrorConfig, { ...currentLoopErrorConfig, retryTimes });
                  }}
                />
              </Box>
            </Box>
          )}

          <FormLabel required fontWeight={'medium'} mb={3} color={'myGray.600'}>
            {t('workflow:loop_body')}
          </FormLabel>
        </Box>

        <Box
          flex={1}
          position={'relative'}
          border={'1px solid'}
          borderColor={'myGray.150'}
          bg={'#F8FAFC'}
          rounded={'10px'}
          overflow={'hidden'}
          backgroundImage="radial-gradient(circle, rgba(148,163,184,0.28) 1px, transparent 1px)"
          backgroundSize="25px 25px"
          backgroundPosition="12px 12px"
          {...(!isFolded && {
            minW: nodeWidth,
            minH: nodeHeight
          })}
        />
      </Container>
      <Container>
        <IOTitle text={t('common:Output')} />
        <RenderOutput nodeId={nodeId} flowOutputList={outputs} />
      </Container>
    </NodeCard>
  );
};

export default React.memo(NodeLoop);

const InputRowLabel = ({
  nodeId,
  input,
  showValueType,
  RightComponent
}: {
  nodeId: string;
  input: FlowNodeInputItemType;
  showValueType?: boolean;
  RightComponent?: React.ReactNode;
}) => {
  const { t } = useTranslation();

  return (
    <Flex alignItems={'center'} className="nodrag" minH={'32px'} gap={2}>
      <Flex alignItems={'center'} flexWrap={'wrap'}>
        <FormLabel required={input.required} mb={0} color={'myGray.700'} fontWeight={'medium'}>
          {t(input.label as any)}
        </FormLabel>
        {input.description && <QuestionTip ml={1} label={t(input.description as any)} />}
        {showValueType !== false && input.valueType && (
          <ValueTypeLabel valueType={input.valueType} valueDesc={input.valueDesc} />
        )}
      </Flex>
      {RightComponent}
      <Box flex={1} />
    </Flex>
  );
};

// Note: loopParallelLimit input no longer renders "manual input" tag.
