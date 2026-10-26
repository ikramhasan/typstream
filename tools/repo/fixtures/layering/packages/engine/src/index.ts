// React below the bindings layer, and a package importing an app.
import { useState } from "react";
import type { App } from "../../../apps/playground/app";

export type Engine = typeof useState | App;
