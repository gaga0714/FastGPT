import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchLoop } from '@fastgpt/service/core/workflow/dispatch/loop/runLoop';
import { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import {
  FlowNodeOutputTypeEnum,
  FlowNodeTypeEnum
} from '@fastgpt/global/core/workflow/node/constant';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';

const mockRunWorkflow = vi.fn();

vi.mock('@fastgpt/service/core/workflow/dispatch', () => ({
  runWorkflow: (...args: any[]) => mockRunWorkflow(...args)
}));

const getBaseProps = () =>
  ({
    params: {
      [NodeInputKeyEnum.loopInputArray]: [],
      [NodeInputKeyEnum.loopParallelLimit]: 3,
      [NodeInputKeyEnum.loopErrorConfig]: {
        retryTimes: 0
      },
      [NodeInputKeyEnum.childrenNodeIdList]: ['loop-start']
    },
    runtimeEdges: [],
    runtimeNodes: [
      {
        nodeId: 'loop-start',
        name: 'Loop Start',
        flowNodeType: FlowNodeTypeEnum.loopStart,
        inputs: [
          {
            key: NodeInputKeyEnum.loopStartInput,
            label: '',
            renderTypeList: [],
            value: ''
          },
          {
            key: NodeInputKeyEnum.loopStartIndex,
            label: '',
            renderTypeList: [],
            value: 0
          }
        ],
        outputs: []
      },
      {
        nodeId: 'loop-end',
        name: 'Loop End',
        flowNodeType: FlowNodeTypeEnum.loopEnd,
        inputs: [],
        outputs: [
          {
            id: NodeOutputKeyEnum.loopArray,
            key: NodeOutputKeyEnum.loopArray,
            type: FlowNodeOutputTypeEnum.static
          }
        ]
      }
    ],
    variables: {
      test: 'value'
    },
    node: {
      nodeId: 'loop-node',
      name: 'Batch Run'
    },
    usagePush: vi.fn(),
    checkIsStopping: () => false
  }) as any;

describe('dispatchLoop', () => {
  beforeEach(() => {
    mockRunWorkflow.mockReset();
  });

  it('should aggregate results by original order and return partial success', async () => {
    mockRunWorkflow.mockImplementation(async ({ runtimeNodes }: any) => {
      const item = runtimeNodes
        .find((node: any) => node.flowNodeType === FlowNodeTypeEnum.loopStart)
        ?.inputs.find((input: any) => input.key === NodeInputKeyEnum.loopStartInput)?.value;

      if (item === 'b') {
        throw new Error('boom');
      }

      return {
        flowResponses: [
          {
            moduleType: FlowNodeTypeEnum.loopEnd,
            loopOutputValue: String(item).toUpperCase()
          }
        ],
        assistantResponses: [],
        flowUsages: [{ totalPoints: 1 }]
      };
    });

    const result = await dispatchLoop({
      ...getBaseProps(),
      params: {
        [NodeInputKeyEnum.loopInputArray]: ['a', 'b', 'c'],
        [NodeInputKeyEnum.loopParallelLimit]: 3,
        [NodeInputKeyEnum.loopErrorConfig]: {
          retryTimes: 0
        },
        [NodeInputKeyEnum.childrenNodeIdList]: ['loop-start']
      }
    });

    expect(result.data).toEqual({
      [NodeOutputKeyEnum.loopArray]: ['A', null, 'C'],
      [NodeOutputKeyEnum.loopRunStatus]: 'partial_success',
      [NodeOutputKeyEnum.loopErrorFeedback]: {
        '2': 'boom'
      }
    });
    expect(result[DispatchNodeResponseKeyEnum.nodeResponse]).toMatchObject({
      loopRunStatus: 'partial_success',
      loopParallelLimit: 3,
      loopRetryTimes: 0
    });
  });

  it('should retry non-timeout errors and succeed on later attempt', async () => {
    let count = 0;
    mockRunWorkflow.mockImplementation(async ({ runtimeNodes }: any) => {
      const item = runtimeNodes
        .find((node: any) => node.flowNodeType === FlowNodeTypeEnum.loopStart)
        ?.inputs.find((input: any) => input.key === NodeInputKeyEnum.loopStartInput)?.value;

      count += 1;
      if (count === 1) {
        throw new Error('temporary');
      }

      return {
        flowResponses: [
          {
            moduleType: FlowNodeTypeEnum.loopEnd,
            loopOutputValue: String(item).toUpperCase()
          }
        ],
        assistantResponses: [],
        flowUsages: [{ totalPoints: 1 }]
      };
    });

    const result = await dispatchLoop({
      ...getBaseProps(),
      params: {
        [NodeInputKeyEnum.loopInputArray]: ['a'],
        [NodeInputKeyEnum.loopParallelLimit]: 1,
        [NodeInputKeyEnum.loopErrorConfig]: {
          retryTimes: 1
        },
        [NodeInputKeyEnum.childrenNodeIdList]: ['loop-start']
      }
    });

    expect(mockRunWorkflow).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({
      [NodeOutputKeyEnum.loopArray]: ['A'],
      [NodeOutputKeyEnum.loopRunStatus]: 'success',
      [NodeOutputKeyEnum.loopErrorFeedback]: {}
    });
  });

  it('should fallback invalid parallel limit and fail interactive responses', async () => {
    mockRunWorkflow.mockResolvedValue({
      flowResponses: [],
      assistantResponses: [],
      flowUsages: [],
      workflowInteractiveResponse: {
        type: 'userSelect'
      }
    });

    const result = await dispatchLoop({
      ...getBaseProps(),
      params: {
        [NodeInputKeyEnum.loopInputArray]: ['a'],
        [NodeInputKeyEnum.loopParallelLimit]: 'invalid',
        [NodeInputKeyEnum.loopErrorConfig]: {
          retryTimes: 0
        },
        [NodeInputKeyEnum.childrenNodeIdList]: ['loop-start']
      }
    });

    expect(result.data).toEqual({
      [NodeOutputKeyEnum.loopArray]: [null],
      [NodeOutputKeyEnum.loopRunStatus]: 'failed',
      [NodeOutputKeyEnum.loopErrorFeedback]: {
        '1': '批量并行节点内不支持交互型暂停节点'
      }
    });
    expect(result[DispatchNodeResponseKeyEnum.nodeResponse]).toMatchObject({
      loopParallelLimit: 10
    });
  });
});
