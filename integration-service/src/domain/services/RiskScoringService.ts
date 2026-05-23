import { calculatePredictiveRiskScore } from '../../riskScoring/engine.js';
import type { RiskScoreResult, RiskScoringInput } from '../../riskScoring/types.js';

export class RiskScoringService {
  score(input: RiskScoringInput): RiskScoreResult {
    return calculatePredictiveRiskScore(input);
  }
}
