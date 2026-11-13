import fs from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

export type EventApprovalScope = 'once' | 'flow' | 'package';
export type EventApprovalChoice = EventApprovalScope | 'deny';

export interface EventDeliveryRequest {
  deliveryId: string;
  event: string;
  source: string;
  target: string;
  sourceIntegrity: string;
  flowId: string | null;
  payloadHash: string;
  operation: 'emit' | 'pipeline' | 'veto';
  occurredAt: string;
}

export interface EventApprovalReceipt {
  receiptVersion: 1;
  receiptId: string;
  decision: EventApprovalScope;
  issuer: string;
  source: string;
  sourceIntegrity: string;
  flowId: string | null;
  deliveryId: string | null;
  payloadHash: string | null;
  issuedAt: string;
  keyId: string;
  signature: string;
  revokedAt?: string;
}

export interface EventGovernanceOptions {
  enabled?: boolean;
  dataDir?: string;
  issuer?: string;
  prompt?: (request: Readonly<EventDeliveryRequest>) => EventApprovalChoice | Promise<EventApprovalChoice>;
}

function canonical(value: any): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value: any): string {
  return `sha256-${createHash('sha256').update(canonical(value)).digest('base64url')}`;
}

function unsigned(receipt: EventApprovalReceipt): Omit<EventApprovalReceipt, 'signature' | 'revokedAt'> {
  const { signature: _signature, revokedAt: _revokedAt, ...body } = receipt;
  return body;
}

/** Durable, host-owned authority for deliveries between packages. */
export class EventGovernance {
  readonly enabled: boolean;
  private options: EventGovernanceOptions;
  private receipts = new Map<string, EventApprovalReceipt>();
  private dataDir: string;
  private privateKey: string;
  private publicKey: string;
  private keyId: string;
  private resolveManifest: (source: string) => any;

  constructor(options: EventGovernanceOptions = {}, workspace = process.cwd(), resolveManifest: (source: string) => any = source => ({ folder: source })) {
    this.options = options;
    this.resolveManifest = resolveManifest;
    this.enabled = options.enabled === true;
    this.dataDir = options.dataDir ?? path.join(workspace, '.logos', 'event-governance');
    if (!this.enabled) {
      this.privateKey = '';
      this.publicKey = '';
      this.keyId = '';
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const privatePath = path.join(this.dataDir, 'signing-key.pem');
    const publicPath = path.join(this.dataDir, 'signing-key.pub.pem');
    if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
      const pair = generateKeyPairSync('ed25519');
      fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      fs.writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    }
    this.privateKey = fs.readFileSync(privatePath, 'utf8');
    this.publicKey = fs.readFileSync(publicPath, 'utf8');
    this.keyId = digest(this.publicKey).slice(7, 23);
    this.load();
  }

  sourceIntegrity(manifest: any): string {
    const { path: _path, dir: _dir, folder, ...declared } = manifest ?? {};
    return digest({ folder, manifest: declared });
  }

  integrityFor(source: string): string {
    return this.sourceIntegrity(this.resolveManifest(source));
  }

  createRequest(input: Omit<EventDeliveryRequest, 'deliveryId' | 'payloadHash' | 'occurredAt'> & { payload: any }): EventDeliveryRequest {
    const { payload, ...rest } = input;
    return Object.freeze({ ...rest, deliveryId: randomUUID(), payloadHash: digest(payload), occurredAt: new Date().toISOString() });
  }

  async authorize(request: EventDeliveryRequest): Promise<boolean> {
    if (!this.enabled || request.source === request.target || request.source === 'system' || request.target === 'system') return true;
    if (this.findValid(request)) return true;
    const choice = await this.options.prompt?.(Object.freeze({ ...request })) ?? 'deny';
    this.audit('decision', request, { choice });
    if (choice === 'deny') return false;
    this.approve(request, choice);
    return true;
  }

  approve(request: EventDeliveryRequest, scope: EventApprovalScope, issuer = this.options.issuer ?? 'local-user'): EventApprovalReceipt {
    if (scope === 'flow' && !request.flowId) throw new TypeError('Flow approval requires flowId');
    const body = {
      receiptVersion: 1 as const, receiptId: randomUUID(), decision: scope, issuer,
      source: request.source, sourceIntegrity: request.sourceIntegrity,
      flowId: scope === 'flow' ? request.flowId : null,
      deliveryId: scope === 'once' ? request.deliveryId : null,
      payloadHash: scope === 'once' ? request.payloadHash : null,
      issuedAt: new Date().toISOString(), keyId: this.keyId,
    };
    const receipt: EventApprovalReceipt = { ...body, signature: sign(null, Buffer.from(canonical(body)), this.privateKey).toString('base64url') };
    this.receipts.set(receipt.receiptId, receipt);
    this.persist();
    this.audit('approved', request, { receiptId: receipt.receiptId, scope });
    return Object.freeze({ ...receipt });
  }

  revoke(receiptId: string): boolean {
    const receipt = this.receipts.get(receiptId);
    if (!receipt || receipt.revokedAt) return false;
    receipt.revokedAt = new Date().toISOString();
    this.persist();
    this.audit('revoked', null, { receiptId });
    return true;
  }

  endFlow(flowId: string): number {
    let count = 0;
    for (const receipt of this.receipts.values()) if (receipt.decision === 'flow' && receipt.flowId === flowId && !receipt.revokedAt) {
      receipt.revokedAt = new Date().toISOString(); count++;
    }
    if (count) this.persist();
    return count;
  }

  list(): ReadonlyArray<Readonly<EventApprovalReceipt>> {
    return [...this.receipts.values()].map(item => Object.freeze({ ...item }));
  }

  verify(receipt: EventApprovalReceipt): boolean {
    if (receipt.keyId !== this.keyId) return false;
    try { return verify(null, Buffer.from(canonical(unsigned(receipt))), this.publicKey, Buffer.from(receipt.signature, 'base64url')); }
    catch { return false; }
  }

  private findValid(request: EventDeliveryRequest): EventApprovalReceipt | null {
    for (const receipt of this.receipts.values()) {
      if (receipt.revokedAt || receipt.source !== request.source || receipt.sourceIntegrity !== request.sourceIntegrity || !this.verify(receipt)) continue;
      if (receipt.decision === 'package') return receipt;
      if (receipt.decision === 'flow' && receipt.flowId === request.flowId) return receipt;
      // A one-time receipt documents the delivery that was authorized in the
      // current call. It is never a reusable credential, even after restart.
    }
    return null;
  }

  private load(): void {
    const file = path.join(this.dataDir, 'receipts.json');
    if (!fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const receipt of Array.isArray(parsed) ? parsed : []) if (receipt?.receiptId && this.verify(receipt)) this.receipts.set(receipt.receiptId, receipt);
    } catch { /* fail closed: unreadable receipts grant nothing */ }
  }

  private persist(): void {
    const file = path.join(this.dataDir, 'receipts.json');
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify([...this.receipts.values()], null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  private audit(action: string, request: EventDeliveryRequest | null, detail: Record<string, any>): void {
    fs.appendFileSync(path.join(this.dataDir, 'audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), action, ...(request ? { deliveryId: request.deliveryId, event: request.event, source: request.source, target: request.target, flowId: request.flowId, payloadHash: request.payloadHash } : {}), ...detail })}\n`, { mode: 0o600 });
  }
}
