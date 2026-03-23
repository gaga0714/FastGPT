import { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import {
  type DispatchNodeResponseType,
  type DispatchNodeResultType,
  type ModuleDispatchProps
} from '@fastgpt/global/core/workflow/runtime/type';
import { runWorkflow } from '..';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { getErrText } from '@fastgpt/global/common/error/utils';
import {
  type AIChatItemValueItemType,
  type ChatHistoryItemResType
} from '@fastgpt/global/core/chat/type';
import { cloneDeep } from 'lodash';
import { storeEdges2RuntimeEdges } from '@fastgpt/global/core/workflow/runtime/utils';
import {
  batchLoopDefaultParallelLimit,
  batchLoopDefaultRetryTimes,
  batchLoopMaxParallelLimit,
  batchLoopMaxRetryTimes,
  normalizeBatchLoopErrorConfig
} from '@fastgpt/global/core/workflow/utils';

type Props = ModuleDispatchProps<{
  [NodeInputKeyEnum.loopInputArray]: Array<any>;
  [NodeInputKeyEnum.loopParallelLimit]?: number;
  [NodeInputKeyEnum.loopErrorConfig]?: {
    retryTimes?: number;
  };
  [NodeInputKeyEnum.childrenNodeIdList]: string[];
}>;
type Response = DispatchNodeResultType<{
  [NodeOutputKeyEnum.loopArray]: Array<any>;
  [NodeOutputKeyEnum.loopRunStatus]: string;
  [NodeOutputKeyEnum.loopErrorFeedback]: Record<string, string>;
}>;

const LOOP_ITEM_TIMEOUT_MESSAGE = '运行超时';
const LOOP_INTERACTIVE_UNSUPPORTED_MESSAGE = '批量并行节点内不支持交互型暂停节点';

const getEnvPositiveInteger = (value: string | undefined, defaultValue: number) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : defaultValue;
};

const getValidParallelLimit = (value: any, maxLimit: number) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return batchLoopDefaultParallelLimit;
  }

  return Math.min(maxLimit, Math.max(1, Math.round(parsed)));
};

const getValidRetryTimes = (value: any, maxRetryTimes: number) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return batchLoopDefaultRetryTimes;
  }

  return Math.min(maxRetryTimes, Math.max(0, Math.round(parsed)));
};

export const dispatchLoop = async (props: Props): Promise<Response> => {
  const {
    params,
    runtimeEdges,
    lastInteractive,
    runtimeNodes,
    checkIsStopping,
    node: { name }
  } = props;
  const {
    loopInputArray = [],
    loopParallelLimit,
    loopErrorConfig,
    childrenNodeIdList = []
  } = params;

  if (!Array.isArray(loopInputArray)) {
    return Promise.reject('Input value is not an array');
  }

  if (lastInteractive?.type === 'loopInteractive') {
    return Promise.reject(LOOP_INTERACTIVE_UNSUPPORTED_MESSAGE);
  }

  // Max loop times
  const maxLength = process.env.WORKFLOW_MAX_LOOP_TIMES
    ? Number(process.env.WORKFLOW_MAX_LOOP_TIMES)
    : 50;
  if (loopInputArray.length > maxLength) {
    return Promise.reject(`Input array length cannot be greater than ${maxLength}`);
  }

  const maxParallelLimit = getEnvPositiveInteger(
    process.env.WORKFLOW_MAX_LOOP_PARALLEL_LIMIT,
    batchLoopMaxParallelLimit
  );
  const maxRetryTimes = getEnvPositiveInteger(
    process.env.WORKFLOW_MAX_LOOP_RETRY_TIMES,
    batchLoopMaxRetryTimes
  );
  const itemTimeoutMs = getEnvPositiveInteger(process.env.WORKFLOW_LOOP_ITEM_TIMEOUT, 1800) * 1000;
  const nodeTimeoutMs = getEnvPositiveInteger(process.env.WORKFLOW_LOOP_NODE_TIMEOUT, 10800) * 1000;

  const parallelLimit = getValidParallelLimit(loopParallelLimit, maxParallelLimit);
  const retryTimes = getValidRetryTimes(
    normalizeBatchLoopErrorConfig(loopErrorConfig).retryTimes,
    maxRetryTimes
  );
  const nodeStartTime = Date.now();
  const outputValueArr = new Array(loopInputArray.length).fill(null);
  const statusList: Array<'success' | 'failed' | 'timeout' | undefined> = new Array(
    loopInputArray.length
  ).fill(undefined);
  const loopResponseDetail: ChatHistoryItemResType[] = [];
  const assistantResponses: AIChatItemValueItemType[] = [];
  const customFeedbacks: string[] = [];
  let totalPoints = 0;
  const errorMap: Record<string, string> = {};

  const isNodeTimedOut = () => Date.now() - nodeStartTime >= nodeTimeoutMs;
  const shouldStopScheduling = () => checkIsStopping() || isNodeTimedOut();
  const setLoopError = (index: number, errorText: string) => {
    errorMap[String(index + 1)] = errorText;
  };

  const executeItem = async (item: any, index: number) => {
    if (shouldStopScheduling()) {
      statusList[index] = 'timeout';
      setLoopError(index, LOOP_ITEM_TIMEOUT_MESSAGE);
      return;
    }

    let attempt = 0;

    while (attempt <= retryTimes) {
      const remainingNodeTimeoutMs = nodeTimeoutMs - (Date.now() - nodeStartTime);
      if (remainingNodeTimeoutMs <= 0 || checkIsStopping()) {
        statusList[index] = 'timeout';
        setLoopError(index, LOOP_ITEM_TIMEOUT_MESSAGE);
        return;
      }

      const currentRuntimeNodes = cloneDeep(runtimeNodes);
      const currentRuntimeEdges = cloneDeep(storeEdges2RuntimeEdges(runtimeEdges));

      currentRuntimeNodes.forEach((node) => {
        if (!childrenNodeIdList.includes(node.nodeId)) return;

        node.isEntry = node.flowNodeType === FlowNodeTypeEnum.loopStart;

        if (node.flowNodeType === FlowNodeTypeEnum.loopStart) {
          node.inputs.forEach((input) => {
            if (input.key === NodeInputKeyEnum.loopStartInput) {
              input.value = item;
            } else if (input.key === NodeInputKeyEnum.loopStartIndex) {
              input.value = index + 1;
            }
          });
        }
      });

      let taskTimedOut = false;
      const timeoutMs = Math.max(1, Math.min(itemTimeoutMs, remainingNodeTimeoutMs));
      const timeoutError = new Error(LOOP_ITEM_TIMEOUT_MESSAGE);
      let timer: NodeJS.Timeout | undefined;

      try {
        const response = await Promise.race([
          runWorkflow({
            ...props,
            usageId: undefined,
            lastInteractive: undefined,
            variables: props.variables,
            runtimeNodes: currentRuntimeNodes,
            runtimeEdges: currentRuntimeEdges,
            checkIsStopping: () => checkIsStopping() || isNodeTimedOut() || taskTimedOut
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              taskTimedOut = true;
              reject(timeoutError);
            }, timeoutMs);
          })
        ]);
        if (timer) {
          clearTimeout(timer);
        }

        if (response.workflowInteractiveResponse) {
          throw new Error(LOOP_INTERACTIVE_UNSUPPORTED_MESSAGE);
        }

        const loopOutputValue = response.flowResponses.find(
          (res) => res.moduleType === FlowNodeTypeEnum.loopEnd
        )?.loopOutputValue;

        outputValueArr[index] = loopOutputValue ?? null;
        statusList[index] = 'success';
        loopResponseDetail.push(...(response.flowResponses ?? []));
        assistantResponses.push(...(response.assistantResponses ?? []));
        totalPoints += (response.flowUsages ?? []).reduce(
          (acc, usage) => acc + usage.totalPoints,
          0
        );

        if (response[DispatchNodeResponseKeyEnum.customFeedbacks]) {
          customFeedbacks.push(...response[DispatchNodeResponseKeyEnum.customFeedbacks]);
        }

        return;
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }
        const errorText = getErrText(error, LOOP_ITEM_TIMEOUT_MESSAGE);
        const isTimeout = taskTimedOut || errorText === LOOP_ITEM_TIMEOUT_MESSAGE;
        const shouldRetry = !isTimeout && errorText !== LOOP_INTERACTIVE_UNSUPPORTED_MESSAGE;

        if (!shouldRetry || attempt >= retryTimes) {
          statusList[index] = isTimeout ? 'timeout' : 'failed';
          outputValueArr[index] = null;
          setLoopError(index, errorText);
          return;
        }
      }

      attempt += 1;
    }
  };

  let currentIndex = 0;
  const workerCount = Math.min(parallelLimit, loopInputArray.length);

  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (currentIndex < loopInputArray.length && !shouldStopScheduling()) {
        const index = currentIndex;
        currentIndex += 1;
        await executeItem(loopInputArray[index], index);
      }
    })
  );

  for (let index = 0; index < statusList.length; index++) {
    if (!statusList[index]) {
      statusList[index] = 'timeout';
      outputValueArr[index] = null;
      setLoopError(index, LOOP_ITEM_TIMEOUT_MESSAGE);
    }
  }

  const successCount = statusList.filter((status) => status === 'success').length;
  const loopRunStatus =
    successCount === statusList.length
      ? 'success'
      : successCount === 0
        ? 'failed'
        : 'partial_success';
  const nodeResponse: DispatchNodeResponseType = {
    totalPoints,
    loopInput: loopInputArray,
    loopResult: outputValueArr,
    loopDetail: loopResponseDetail,
    loopRunStatus,
    loopErrorFeedback: errorMap,
    loopParallelLimit: parallelLimit,
    loopRetryTimes: retryTimes,
    mergeSignId: props.node.nodeId
  };

  return {
    data: {
      [NodeOutputKeyEnum.loopArray]: outputValueArr,
      [NodeOutputKeyEnum.loopRunStatus]: loopRunStatus,
      [NodeOutputKeyEnum.loopErrorFeedback]: errorMap
    },
    [DispatchNodeResponseKeyEnum.assistantResponses]: assistantResponses,
    [DispatchNodeResponseKeyEnum.nodeResponse]: nodeResponse,
    [DispatchNodeResponseKeyEnum.nodeDispatchUsages]: totalPoints
      ? [
          {
            totalPoints,
            moduleName: name
          }
        ]
      : [],
    [DispatchNodeResponseKeyEnum.customFeedbacks]:
      customFeedbacks.length > 0 ? customFeedbacks : undefined
  };
};
