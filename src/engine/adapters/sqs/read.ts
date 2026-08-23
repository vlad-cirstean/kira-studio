import {
  GetQueueAttributesCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  createStreamPageBuilder,
  type PagePosition,
  type StreamPage,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { mapSqsError } from './errors';

const RECEIVE_LIMIT = 10; // ReceiveMessage's own hard per-call cap on MaxNumberOfMessages
const WAIT_TIME_SECONDS = 1; // short poll per call; looped rather than one long wait

function pushMessage(builder: ReturnType<typeof createStreamPageBuilder>, message: Message): void {
  const attrs = message.Attributes ?? {};
  const sentTimestamp = attrs.SentTimestamp ? Number(attrs.SentTimestamp) : null;
  builder.push({
    key: message.MessageId ?? null,
    headers: JSON.stringify(message.MessageAttributes ?? {}),
    attrs: JSON.stringify(attrs),
    timestamp: sentTimestamp !== null ? new Date(sentTimestamp).toISOString() : null,
    body: message.Body ?? '',
  });
}

function position(pageSize: number): PagePosition {
  // D11: SQS has no addressable position at all — every poll is an independent, non-resumable
  // snapshot.
  return {
    offset: null,
    pageSize,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'batch',
  };
}

async function fetchVisibilityTimeout(client: SQSClient, queueUrl: string): Promise<number | null> {
  try {
    const result = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['VisibilityTimeout'] }),
    );
    const raw = result.Attributes?.VisibilityTimeout;
    return raw ? Number(raw) : null;
  } catch {
    return null; // best-effort, mirrors redis/read.ts's MEMORY USAGE fallback
  }
}

// D10/D12: never called automatically by the view — always an explicit user-initiated poll.
// Loops ReceiveMessageCommand (hard-capped at 10 messages per call) up to ceil(pageSize/10)
// times, stopping early on any empty/partial batch (the queue is plausibly drained for this
// poll). One GetQueueAttributes call per poll feeds both this page's visibilityTimeoutSeconds
// and countQueue()'s approximate count.
export async function pollQueue(
  client: SQSClient,
  queueUrl: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<StreamPage> {
  const visibilityTimeoutSeconds = await fetchVisibilityTimeout(client, queueUrl);
  const builder = createStreamPageBuilder({ visibilityTimeoutSeconds });
  let collected = 0;

  ctx.setCommand(`ReceiveMessage ${queueUrl}`);
  while (collected < req.pageSize) {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    const batchLimit = Math.min(RECEIVE_LIMIT, req.pageSize - collected);
    let result: { Messages?: Message[] };
    try {
      result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: batchLimit,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          MessageAttributeNames: ['All'],
          MessageSystemAttributeNames: ['All'],
        }),
        { abortSignal: ctx.signal },
      );
    } catch (err) {
      throw mapSqsError(err);
    }
    const messages = result.Messages ?? [];
    for (const message of messages) pushMessage(builder, message);
    collected += messages.length;
    if (messages.length < batchLimit) break; // short of a full batch — queue is likely drained
  }

  return builder.finish(position(req.pageSize));
}

// D6/D11: approximate only — ApproximateNumberOfMessages is an eventually-consistent estimate,
// never an exact count (SQS has no exact-count operation).
export async function countQueue(
  client: SQSClient,
  queueUrl: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  let result: { Attributes?: Partial<Record<string, string>> };
  try {
    result = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
      { abortSignal: ctx.signal },
    );
  } catch (err) {
    throw mapSqsError(err);
  }
  const raw = result.Attributes?.ApproximateNumberOfMessages;
  return { value: raw ? Number(raw) : 0, exact: false };
}
