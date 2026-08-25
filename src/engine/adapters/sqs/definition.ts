import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { DefinitionSection, ObjectDefinition } from '../../../shared/domain/definition';
import { encodePath } from '../../../shared/domain/tree';
import { mapError } from './errors';

// P23 D9: a queue genuinely *is* its attributes — visibility timeout, retention, delay, redrive
// policy, FIFO/dedup, KMS key, ARN, timestamps — none of which the app shows anywhere today. One
// command the adapter already imports (sqs/read.ts), one round trip, no new dependency. This is
// not a ReceiveMessage call and hides nothing — SPEC §5.1's "SQS reads are never automatic" rule
// is about message visibility, which GetQueueAttributes neither touches nor needs to auto-poll for.

// A few attribute values are themselves JSON policy documents — pretty-print those specifically
// rather than every attribute, so a plain string like an ARN or a timestamp stays a plain string.
const JSON_ATTRIBUTES = new Set(['RedrivePolicy', 'Policy', 'RedriveAllowPolicy']);

function formatValue(name: string, value: string): string {
  if (!JSON_ATTRIBUTES.has(name)) return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export async function buildQueueDefinition(
  client: SQSClient,
  queueUrl: string,
  name: string,
): Promise<ObjectDefinition> {
  let attributes: Record<string, string>;
  try {
    const result = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['All'] }),
    );
    attributes = result.Attributes ?? {};
  } catch (err) {
    throw mapError(err);
  }

  const names = Object.keys(attributes).sort();
  const attributesSection: DefinitionSection = {
    title: 'Attributes',
    rows: names.map((n) => ({
      name: n,
      value: formatValue(n, attributes[n] as string),
      detail: null,
    })),
  };

  return {
    path: encodePath([{ kind: 'queue', name }]),
    kind: 'queue',
    qualifiedName: name,
    language: 'json',
    statements: [JSON.stringify(attributes, null, 2)],
    origin: 'server',
    notes: [],
    constraints: [],
    documentSchema: null,
    sections: [attributesSection],
    generatedAt: new Date().toISOString(),
  };
}
