<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

/**
 * Read-only search over the native GLPI Knowledge Base (glpi_knowbaseitems).
 *
 * Phase: integaglpi_ai_kb_ecosystem_ui_and_wiring_001.
 *
 * Exposed to the Node SmartHelpService through the bearer-gated internal endpoint
 * front/kb.search.php. The Node side never touches MariaDB directly — PHP owns
 * GLPI DB access and returns only sanitized, visibility-filtered article rows.
 */
final class KbSearchService
{
    private NativeKnowledgeBaseService $native;

    public function __construct(?NativeKnowledgeBaseService $native = null)
    {
        $this->native = $native ?? new NativeKnowledgeBaseService();
    }

    /**
     * @return list<array{id:int,title:string,category:string,snippet:string,url:string,score:float}>
     */
    public function search(string $query, int $limit = 5): array
    {
        $limit = max(1, min(10, $limit));
        $query = trim($query);

        $results = [];
        foreach ($this->native->searchVisibleArticles($query, $limit) as $article) {
            $id = (int) ($article['article_id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            $results[] = [
                'id'       => $id,
                'title'    => (string) ($article['title'] ?? ''),
                'category' => (string) ($article['category'] ?? ''),
                // Bounded snippet — no raw HTML (NativeKnowledgeBaseService already sanitizes).
                'snippet'  => mb_substr((string) ($article['excerpt'] ?? ''), 0, 300, 'UTF-8'),
                'url'      => (string) ($article['internal_url'] ?? ''),
                // Native KB search has no numeric relevance; a neutral score lets the
                // Node SmartHelp feedback-bias decide ordering. The 80% gate means a
                // bare native hit is treated as a "related" suggestion, not an auto-resolve.
                'score'    => 0.7,
            ];
        }

        return $results;
    }
}
