import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "@effect/platform";

export const makeAppLayer = () =>
  Layer.mergeAll(FetchHttpClient.layer);

export const makeRuntime = () => ManagedRuntime.make(makeAppLayer());
