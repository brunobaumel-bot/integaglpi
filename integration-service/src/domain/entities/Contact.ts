export interface Contact {
  id: string;
  phoneE164: string;
  glpiContactId: number | null;
  glpiUserId: number | null;
  name: string | null;
  source: string;
  cacheKey: string;
  createdAt: Date;
  updatedAt: Date;
}

