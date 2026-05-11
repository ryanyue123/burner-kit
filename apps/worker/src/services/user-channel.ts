import { Context } from "effect";
import type { UserChannel } from "../durable-objects/user-channel";

export class UserChannels extends Context.Tag("UserChannels")<
  UserChannels,
  DurableObjectNamespace<UserChannel>
>() {}
