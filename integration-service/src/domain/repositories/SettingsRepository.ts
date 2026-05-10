export interface SettingsRepository {
  findMessageSettings(): Promise<Map<string, string>>;
  findBusinessHoursSettings(): Promise<Map<string, unknown>>;
}
