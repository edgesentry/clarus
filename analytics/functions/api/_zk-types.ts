// Types mirroring clarus/schemas/zk-bca-greenmark.json (source of truth)

export type ZkFramework = "sp1" | "risc0" | "mock";

export type CertLevel = "not_certified" | "certified" | "gold" | "gold_plus" | "platinum";

export interface ZkProof {
  framework:     ZkFramework;
  program_id:    string;
  proof_bytes:   string; // base64
  public_values: string; // base64 JSON → GreenMarkAttestation
}

export interface GreenMarkAttestation {
  site_id:           string;
  eui_kwh_m2:        number;
  cert_level:        CertLevel;
  all_criteria_pass: boolean;
  cop_pass:          boolean;
  lpd_pass:          boolean;
  period_start_ms:   number;
  period_end_ms:     number;
}

export interface AuditRecord {
  sequence:         number;
  timestamp_ms:     number;
  record_hash_hex?: string;
  attestation?:     GreenMarkAttestation; // top-level BCA compliance result (new format)
  zk_proof?:        ZkProof;              // optional ZKP proof for future SP1 / B2B path
}

// Minimal R2 surface used by these functions — avoids @cloudflare/workers-types
// in the root tsconfig (which conflicts with DOM lib used by the analytics app).
export interface R2Object {
  text(): Promise<string>;
}

export interface R2ListResult {
  objects: Array<{ key: string }>;
}

export interface R2BucketMinimal {
  get(key: string): Promise<R2Object | null>;
  list(opts: { prefix: string; limit: number }): Promise<R2ListResult>;
}

export interface Env {
  CLARUS_DEV_PUBLIC_RAW:       R2BucketMinimal;
  CLARUS_DEV_PUBLIC_AUDIT:     R2BucketMinimal;
  CLARUS_DEV_PUBLIC_ANALYTICS: R2BucketMinimal;
}
