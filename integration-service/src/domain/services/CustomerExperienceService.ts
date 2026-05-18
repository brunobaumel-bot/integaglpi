import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { ContactProfileData, ContactProfileService } from './ContactProfileService.js';
import { logger } from '../../infra/logger/logger.js';

export type GlpiUserResolutionStatus =
  | 'linked_existing'
  | 'created_restricted'
  | 'existing_link_preserved'
  | 'email_missing'
  | 'email_invalid'
  | 'entity_required'
  | 'ambiguous'
  | 'inactive'
  | 'failed';

export interface ResolveGlpiRequesterInput {
  phoneE164: string;
  profile: ContactProfileData | null;
  entitiesId: number | null | undefined;
  conversationId?: string | null;
}

export interface ResolveGlpiRequesterResult {
  status: GlpiUserResolutionStatus;
  glpiUserId: number | null;
  created: boolean;
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return '[invalid-email]';
  }

  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  if (digits.length < 8) {
    return '******';
  }

  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

export class CustomerExperienceService {
  public constructor(
    private readonly glpiClient: Pick<GlpiClient, 'findUsersByEmail' | 'createRestrictedRequesterUser'>,
    private readonly contactProfileService: Pick<ContactProfileService, 'normalizeEmail' | 'saveProfileData'>,
  ) {}

  public async resolveGlpiRequester(input: ResolveGlpiRequesterInput): Promise<ResolveGlpiRequesterResult> {
    const profile = input.profile;
    if (!profile) {
      return { status: 'email_missing', glpiUserId: null, created: false };
    }

    const existingUserId = Number(profile.glpi_user_id ?? 0);
    if (Number.isInteger(existingUserId) && existingUserId > 0) {
      return { status: 'existing_link_preserved', glpiUserId: existingUserId, created: false };
    }

    const normalizedEmail = this.contactProfileService.normalizeEmail(profile.email_address ?? '');
    if (!normalizedEmail) {
      const status = profile.email_status === 'invalid' ? 'email_invalid' : 'email_missing';
      await this.persistLinkState(input.phoneE164, profile, status, null, false, input.conversationId);
      return { status, glpiUserId: null, created: false };
    }

    if (!Number.isFinite(input.entitiesId) || Number(input.entitiesId) <= 0) {
      await this.persistLinkState(input.phoneE164, profile, 'entity_required', null, false, input.conversationId);
      return { status: 'entity_required', glpiUserId: null, created: false };
    }

    const entitiesId = Math.trunc(Number(input.entitiesId));

    try {
      const users = await this.glpiClient.findUsersByEmail(normalizedEmail);
      const activeUsers = users.filter((user) => user.isActive);
      if (activeUsers.length === 1 && users.length === 1) {
        const glpiUserId = activeUsers[0].id;
        await this.persistLinkState(input.phoneE164, profile, 'linked_existing', glpiUserId, false, input.conversationId);
        this.logResolution('linked_existing', input, normalizedEmail, glpiUserId);
        return { status: 'linked_existing', glpiUserId, created: false };
      }

      if (users.length > 1 || activeUsers.length > 1) {
        await this.persistLinkState(input.phoneE164, profile, 'ambiguous', null, false, input.conversationId);
        this.logResolution('ambiguous', input, normalizedEmail, null);
        return { status: 'ambiguous', glpiUserId: null, created: false };
      }

      if (users.length === 1 && activeUsers.length === 0) {
        await this.persistLinkState(input.phoneE164, profile, 'inactive', null, false, input.conversationId);
        this.logResolution('inactive', input, normalizedEmail, null);
        return { status: 'inactive', glpiUserId: null, created: false };
      }

      const glpiUserId = await this.glpiClient.createRestrictedRequesterUser({
        email: normalizedEmail,
        requesterName: profile.requester_name ?? null,
        companyName: profile.company_name_raw ?? null,
        phoneE164: input.phoneE164,
        entitiesId,
      });
      await this.persistLinkState(input.phoneE164, profile, 'created_restricted', glpiUserId, true, input.conversationId);
      this.logResolution('created_restricted', input, normalizedEmail, glpiUserId);
      return { status: 'created_restricted', glpiUserId, created: true };
    } catch (error: unknown) {
      await this.persistLinkState(input.phoneE164, profile, 'failed', null, false, input.conversationId);
      logger.warn(
        {
          conversation_id: input.conversationId ?? null,
          phone_masked: maskPhone(input.phoneE164),
          email_masked: maskEmail(normalizedEmail),
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][customer_experience][GLPI_USER_RESOLUTION_FAILED]',
      );
      return { status: 'failed', glpiUserId: null, created: false };
    }
  }

  private async persistLinkState(
    phoneE164: string,
    profile: ContactProfileData,
    status: GlpiUserResolutionStatus,
    glpiUserId: number | null,
    created: boolean,
    conversationId?: string | null,
  ): Promise<void> {
    await this.contactProfileService.saveProfileData(phoneE164, {
      ...profile,
      phone_e164: phoneE164,
      email_address: this.contactProfileService.normalizeEmail(profile.email_address ?? ''),
      email_status: this.contactProfileService.normalizeEmail(profile.email_address ?? '')
        ? 'valid'
        : profile.email_status ?? 'not_provided',
      glpi_user_id: glpiUserId,
      glpi_user_link_status: status,
      glpi_user_link_source: created ? 'created_whatsapp_integaglpi' : status === 'linked_existing' ? 'email_unique_active' : 'manual_required',
      glpi_user_linked_at: glpiUserId ? new Date().toISOString() : null,
      glpi_user_created_by_integaglpi: created,
      last_conversation_id: conversationId ?? profile.last_conversation_id ?? null,
    } as ContactProfileData, conversationId ?? profile.last_conversation_id ?? null);
  }

  private logResolution(
    status: GlpiUserResolutionStatus,
    input: ResolveGlpiRequesterInput,
    email: string,
    glpiUserId: number | null,
  ): void {
    logger.info(
      {
        conversation_id: input.conversationId ?? null,
        status,
        glpi_user_id: glpiUserId,
        phone_masked: maskPhone(input.phoneE164),
        email_masked: maskEmail(email),
      },
      '[integration-service][customer_experience][GLPI_USER_RESOLUTION]',
    );
  }
}
