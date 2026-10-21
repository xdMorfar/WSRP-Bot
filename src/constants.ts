export const BRAND = {
  defaultName: 'Wisconsin State Roleplay',
  primary: 0x1f4f8f,
  success: 0x2f8f5b,
  warning: 0xc98a2e,
  danger: 0xb13b3b,
};

export const CUSTOM = {
  setupSection: 'setup:section',
  ticketCreate: 'ticket:create',
  dashboardSection: 'dashboard:section',
  sessionVote: 'session:vote',
};

export const DEFAULT_TICKET_CATEGORIES = [
  {
    key: 'general',
    label: 'General Support',
    description: 'Questions and service-related assistance.',
    supportRoleIds: [],
    restrictedRoleIds: [],
    questions: ['Briefly explain what you need help with.'],
  },
  {
    key: 'player-report',
    label: 'Player Report',
    description: 'Report a player. Evidence is strongly recommended.',
    supportRoleIds: [],
    restrictedRoleIds: [],
    questions: ['Who are you reporting?', 'What happened?', 'Evidence links, if available'],
  },
  {
    key: 'staff-report',
    label: 'Staff Report / Internal Affairs',
    description: 'Confidential staff conduct reports for IA/management.',
    supportRoleIds: [],
    restrictedRoleIds: [],
    questions: ['Which staff member are you reporting?', 'Describe the conduct.', 'Evidence links, if available'],
  },
  {
    key: 'appeal',
    label: 'Punishment Appeal',
    description: 'Request review of a Discord or in-game punishment.',
    supportRoleIds: [],
    restrictedRoleIds: [],
    questions: ['Which punishment are you appealing?', 'Why should it be reviewed?', 'Case ID or evidence, if known'],
  },
  {
    key: 'partnership',
    label: 'Partnership Request',
    description: 'Partnership and community collaboration requests.',
    supportRoleIds: [],
    restrictedRoleIds: [],
    questions: ['Tell us about your community.', 'What partnership are you proposing?'],
  },
];

export const DEFAULT_APPLICATIONS = [
  {
    key: 'staff',
    title: 'Staff Applications',
    description: 'Apply to join the Wisconsin State Roleplay staff team through Melonly.',
    requirements: 'Read all requirements on the application page before submitting.',
    status: 'closed' as const,
    buttonLabel: 'Open Staff Application',
  },
  {
    key: 'department',
    title: 'Department Applications',
    description: 'Department application information and access.',
    requirements: 'Department requirements may vary.',
    status: 'closed' as const,
    buttonLabel: 'Open Department Application',
  },
  {
    key: 'internal-affairs',
    title: 'Internal Affairs Applications',
    description: 'Apply for Internal Affairs through the configured Melonly form.',
    requirements: 'Applicants must meet the requirements shown on Melonly.',
    status: 'closed' as const,
    buttonLabel: 'Open IA Application',
  },
];
