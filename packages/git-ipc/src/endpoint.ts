/**
 * The concrete instantiation of `@kira/ipc-core`'s generic RPC endpoint over Git's own `Contract`
 * — the one place this package binds the generic machinery to Git's version and vocabulary. A
 * host and the harness's mock bridge each still contribute only their own `MessageChannelLike`
 * adapter; everything above that is `createRpcClient`/`createRpcServer` below.
 */
import {
  type RequestHandler as CoreRequestHandler,
  type RpcServer as CoreRpcServer,
  type ServerHandlers as CoreServerHandlers,
  type StreamHandler as CoreStreamHandler,
  type Transport as CoreTransport,
  createRpcClient as coreCreateRpcClient,
  createRpcServer as coreCreateRpcServer,
  type EndpointConfig,
  type MessageChannelLike,
} from '@kira/ipc-core';
import type { Contract, RequestKey, StreamKey } from './contract';
import { assertContractShape, CONTRACT_VERSION } from './validate';

const GIT_ENDPOINT: EndpointConfig = {
  contractVersion: CONTRACT_VERSION,
  assertShape: assertContractShape,
};

export type Transport = CoreTransport<Contract>;
export type RequestHandler<K extends RequestKey> = CoreRequestHandler<Contract, K>;
export type StreamHandler<K extends StreamKey> = CoreStreamHandler<Contract, K>;
export type ServerHandlers = CoreServerHandlers<Contract>;
export type RpcServer = CoreRpcServer<Contract>;

export function createRpcClient(channel: MessageChannelLike): Transport {
  return coreCreateRpcClient<Contract>(channel, GIT_ENDPOINT);
}
export function createRpcServer(channel: MessageChannelLike, handlers: ServerHandlers): RpcServer {
  return coreCreateRpcServer<Contract>(channel, handlers, GIT_ENDPOINT);
}
