import {
  FlowNodeInputTypeEnum,
  FlowNodeOutputTypeEnum,
  FlowNodeTypeEnum
} from '../../../node/constant';
import { type FlowNodeTemplateType } from '../../../type/node';
import {
  FlowNodeTemplateTypeEnum,
  NodeInputKeyEnum,
  NodeOutputKeyEnum,
  WorkflowIOValueTypeEnum
} from '../../../constants';
import { i18nT } from '../../../../../../web/i18n/utils';
import {
  Input_Template_Children_Node_List,
  Input_Template_LOOP_NODE_OFFSET,
  Input_Template_Node_Height,
  Input_Template_Node_Width
} from '../../input';
import { batchLoopDefaultParallelLimit, getBatchLoopDefaultErrorConfig } from '../../../utils';

export const LoopNode: FlowNodeTemplateType = {
  id: FlowNodeTypeEnum.loop,
  templateType: FlowNodeTemplateTypeEnum.tools,
  flowNodeType: FlowNodeTypeEnum.loop,
  showSourceHandle: true,
  showTargetHandle: true,
  avatar: 'core/workflow/template/loop',
  avatarLinear: 'core/workflow/template/loopLinear',
  colorSchema: 'violetDeep',
  name: i18nT('workflow:loop'),
  intro: i18nT('workflow:intro_loop'),
  showStatus: true,
  courseUrl: '/docs/introduction/guide/dashboard/workflow/loop/',
  inputs: [
    {
      key: NodeInputKeyEnum.loopInputArray,
      renderTypeList: [FlowNodeInputTypeEnum.reference],
      valueType: WorkflowIOValueTypeEnum.arrayAny,
      required: true,
      label: i18nT('workflow:loop_input_array'),
      value: []
    },
    {
      key: NodeInputKeyEnum.loopParallelLimit,
      renderTypeList: [FlowNodeInputTypeEnum.numberInput, FlowNodeInputTypeEnum.reference],
      valueType: WorkflowIOValueTypeEnum.number,
      required: true,
      label: i18nT('workflow:loop_parallel_limit'),
      min: 1,
      max: 50,
      value: batchLoopDefaultParallelLimit
    },
    {
      key: NodeInputKeyEnum.loopErrorConfig,
      renderTypeList: [FlowNodeInputTypeEnum.hidden],
      valueType: WorkflowIOValueTypeEnum.object,
      label: '',
      value: getBatchLoopDefaultErrorConfig()
    },
    Input_Template_Children_Node_List,
    Input_Template_Node_Width,
    Input_Template_Node_Height,
    Input_Template_LOOP_NODE_OFFSET
  ],
  outputs: [
    {
      id: NodeOutputKeyEnum.loopArray,
      key: NodeOutputKeyEnum.loopArray,
      label: i18nT('workflow:loop_result'),
      type: FlowNodeOutputTypeEnum.static,
      valueType: WorkflowIOValueTypeEnum.arrayAny
    },
    {
      id: NodeOutputKeyEnum.loopRunStatus,
      key: NodeOutputKeyEnum.loopRunStatus,
      label: i18nT('workflow:loop_run_status'),
      description: i18nT('workflow:loop_run_status_desc'),
      type: FlowNodeOutputTypeEnum.static,
      valueType: WorkflowIOValueTypeEnum.string,
      required: true
    },
    {
      id: NodeOutputKeyEnum.loopErrorFeedback,
      key: NodeOutputKeyEnum.loopErrorFeedback,
      label: i18nT('workflow:loop_error_feedback'),
      description: i18nT('workflow:loop_error_feedback_desc'),
      type: FlowNodeOutputTypeEnum.static,
      valueType: WorkflowIOValueTypeEnum.object
    }
  ]
};
