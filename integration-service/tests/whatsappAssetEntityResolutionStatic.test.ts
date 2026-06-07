import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inbound = readFileSync('src/domain/services/InboundWebhookService.ts', 'utf8');
const glpiClient = readFileSync('src/adapters/glpi/GlpiClient.ts', 'utf8');
const glpiTypes = readFileSync('src/adapters/glpi/glpiTypes.ts', 'utf8');

describe('WhatsApp asset entity resolution static contract', () => {
  it('looks up GLPI Computer by otherserial without mutating inventory', () => {
    expect(glpiTypes).toContain('GlpiComputerAssetCandidate');
    expect(glpiClient).toContain('findComputersByOtherserial');
    expect(glpiClient).toContain('/search/Computer?');
    expect(glpiClient).toContain("criteria[0][field]', '6'");
    expect(glpiClient).toContain("criteria[0][searchtype]', 'equals'");

    const lookupSection = glpiClient.slice(
      glpiClient.indexOf('private async searchComputersByOtherserial'),
      glpiClient.indexOf('private async requestJson'),
    );
    expect(lookupSection).toContain("method: 'GET'");
    expect(lookupSection).not.toMatch(/\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
  });

  it('uses equipment tag entity before stale contact memory and persists the evidence', () => {
    expect(inbound).toContain('resolveEntityFromEquipmentTagOrMemory');
    expect(inbound).toContain('this.glpiClient.findComputersByOtherserial(equipmentTag, 10)');
    expect(inbound).toContain("source: 'asset_tag_match'");
    expect(inbound).toContain('CONTACT_ENTITY_RESOLVED_FROM_ASSET_TAG');
    expect(inbound).toContain('CONTACT_ENTITY_ASSET_TAG_DUPLICATE');
    expect(inbound).toContain('return null;');
  });

  it('passes known entity to native triage cache and retries without invalid category', () => {
    expect(inbound).toContain('resolveRoutingOptions(entityId: number | null = null)');
    expect(inbound).toContain('normalizer.getOptions(entityId)');
    expect(inbound).toContain('knownEntityForTriage');
    expect(inbound).toContain('createTicketWithNativeCategoryFallback');
    expect(inbound).toContain('GLPI_NATIVE_CATEGORY_RETRY_WITHOUT_CATEGORY');
    expect(inbound).toContain('itilcategoriesId: null');
  });
});
