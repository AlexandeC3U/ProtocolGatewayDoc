// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'INDEX',
    {
      type: 'category',
      label: 'Chapters',
      collapsed: false,
      items: [
        'pages/summary',
        'pages/system_overview',
        'pages/architectural_principles',
        'pages/layer_architecture',
        'pages/domain_model',
        'pages/protocol_adapters',
        'pages/connection_management',
        'pages/dataflow_architecture',
        'pages/resilience_patterns',
        'pages/observability_infrastructure',
        'pages/security_architecture',
        'pages/deployment_architecture',
        'pages/web_architecture',
        'pages/testing_strategy',
        'pages/standards_compliance',
        'pages/appendices',
        'pages/edge_cases',
        'pages/device_configuration',
        'pages/conclusion',
      ],
    },
  ],
};

export default sidebars;
