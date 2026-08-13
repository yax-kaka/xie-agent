import type { InlineExtension } from "../core/extensions/types.ts";
import llamaExtension from "./llama/index.ts";
import piXieExtension from "./pi-xie/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "pi-xie", factory: piXieExtension, hidden: true },
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
];
