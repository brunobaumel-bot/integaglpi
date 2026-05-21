export interface SettingsRepository {
  findMessageSettings(): Promise<Map<string, string>>;
  findBusinessHoursSettings(): Promise<Map<string, unknown>>;
  findContactProfileSettings(): Promise<Map<string, unknown>>;
  findEntityResolutionSettings(): Promise<Map<string, unknown>>;
  findInactivitySettings(): Promise<Map<string, unknown>>;
}
