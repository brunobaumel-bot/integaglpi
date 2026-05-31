export const COPILOT_DRAFT_VERSION = 'internal_copilot_draft_v1';

export const COPILOT_TONES = ['friendly', 'technical', 'neutral', 'concise'] as const;
export const COPILOT_WINDOW_NOTICES = ['open_24h', 'closed_24h', 'unknown'] as const;

export type CopilotTone = typeof COPILOT_TONES[number];
export type CopilotWindowNotice = typeof COPILOT_WINDOW_NOTICES[number];

export interface CopilotKbReference {
  articleId: number;
  title: string;
  internalUrl: string;
}

export interface CopilotDraftResult {
  draftResponse: string;
  sourceType?: 'kb' | 'history' | 'conversation' | 'profile' | 'entity' | 'fallback' | 'ai';
  sourceName?: string;
  confidence?: 'low' | 'medium' | 'high';
  warnings?: string[];
  tone: CopilotTone;
  kbReferences: CopilotKbReference[];
  assumptions: string[];
  missingInformation: string[];
  safetyWarnings: string[];
  technicianChecklist: string[];
  confidenceScore: number;
  windowNotice: CopilotWindowNotice;
  templateNotice: string;
  noAutoSend: true;
}

export interface CopilotContextMessage {
  direction: string;
  messageType: string;
  text: string;
  createdAt: string;
}

export interface CopilotKbArticle {
  articleId: number;
  title: string;
  category: string;
  excerpt: string;
  internalUrl: string;
}

export interface CopilotContext {
  conversationId: string;
  glpiTicketId: number;
  ticketTitle: string;
  ticketStatus: string;
  queueName: string;
  slaLabel: string;
  windowNotice: CopilotWindowNotice;
  messages: CopilotContextMessage[];
  kbArticles: CopilotKbArticle[];
  aiQuality: Record<string, unknown> | null;
  kbCandidates: Array<Record<string, unknown>>;
  historicalInsights: Array<Record<string, unknown>>;
}
