// Allowed: react → dom, and React itself.
import type { Dom } from "@typstream/dom";
import { useState } from "react";

export type ReactBinding = Dom | typeof useState;
