/**
 * Public, network-accessible exposure of a single artifact inside Reflex.
 * Owner of the truth lives on disk in `~/.reflex/shares.json` so shares
 * survive restarts and HMR. URLs are unguessable random ids — passwords
 * are an optional second factor on top.
 */
export type ShareKind = "utility" | "kb-file" | "kb-tree" | "project";

export interface Share {
  /** 12-char random base32 id used in the public URL. */
  id: string;
  kind: ShareKind;
  /**
   * What's actually exposed:
   *   - utility:  rootId + utility id + scope ("global"|"project")
   *   - kb-file:  rootId + rel-path under <root>/.reflex/kb/
   *   - kb-tree:  rootId (whole KB tree, browseable)
   *   - project:  rootId (read-only dashboard)
   */
  rootId?: string;
  utilityScope?: "global" | "project";
  utilityId?: string;
  kbRelPath?: string;
  /**
   * Optional SHA-256 hash (hex) of (`salt`+password). Empty = public link.
   * We never store the plaintext.
   */
  passwordHash?: string;
  /** Random salt used to derive the hash. Empty if no password. */
  passwordSalt?: string;
  /** Optional ISO timestamp after which the share returns 410 Gone. */
  expiresAt?: string;
  createdAt: string;
  /** Free-form label the user sees in the shares list. */
  label?: string;
  /** Last time someone fetched the share — for analytics / cleanup. */
  lastAccessedAt?: string;
}

export interface ShareFile {
  version: 1;
  shares: Share[];
}
