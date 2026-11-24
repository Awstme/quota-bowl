import type { Metric } from '../../lib/api/client';

const providers: Record<string, string> = {
  opendesign: 'OpenDesign',
  opencodego: 'OpenCode Go',
  commandcode: 'CommandCode',
};

const metrics: Record<string, string> = {
  '5h_used_percent': '5 小时使用率',
  weekly_used_percent: '每周使用率',
  monthly_used_percent: '每月使用率',
};

const failures: Record<string, string> = {
  workspace_required: '此采集目标未配置工作区。',
  workspace_unverified: '无法验证采集结果的工作区。',
  workspace_mismatch: '采集结果与配置的工作区不一致。',
  credential_decryption_failed: '无法读取旧版密钥。请重新保存凭据，或为 Worker 提供原私钥。',
  credential_missing: '请在「密钥管理」中保存采集凭据。',
  credential_unreadable: '采集服务无法读取凭据，请检查凭据配置和文件权限。',
  credential_invalid: '采集凭据无效，请检查凭据配置。',
  cli_setup_failed: '无法准备采集工具的运行环境。',
  cli_cleanup_failed: '采集工具未能清理运行环境。',
  cli_unavailable: '找不到采集工具，请检查安装和路径配置。',
  cli_timeout: '采集工具响应超时，可稍后重试。',
  cli_failed: '采集工具运行失败，请检查服务端日志。',
  invalid_output: '采集工具返回了无法读取的数据。',
  unexpected_source: '采集结果的来源与配置不符。',
  no_usage: '采集结果中没有用量数据。',
};

export const providerName = (value: string) => Object.hasOwn(providers, value) ? providers[value] : value;
export const metricLabel = (metric: Metric) => Object.hasOwn(metrics, metric.key) ? metrics[metric.key] : metric.label;
export const collectionError = (code?: string) => code && Object.hasOwn(failures, code) ? failures[code] : '请检查采集配置和服务端日志，或稍后重试。';
