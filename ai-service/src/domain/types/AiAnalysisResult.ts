export interface AiAnalysisResult {
  shouldCreateTicket: boolean;
  title: string;
  description: string;
  category: string;
  urgency: number;
  analysis: string;
}
