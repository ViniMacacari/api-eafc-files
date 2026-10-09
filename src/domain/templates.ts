export const SUPPORTED_VERSIONS = Object.freeze(['FC 25', 'FC 26'] as const);
export type EaFcVersion = (typeof SUPPORTED_VERSIONS)[number];

export const TEMPLATE_DATABASES = Object.freeze(['main', 'fut', 'localization'] as const);
export type TemplateDatabase = (typeof TEMPLATE_DATABASES)[number];
