// Trusted Types (#70). A page that sends `require-trusted-types-for 'script'`
// refuses strings at script sinks unless a policy made them. typstream has
// three: the `<template>`s the HTML renderer and the paged view parse markup
// into (inert, and sanitized before anything reaches the page), and the engine
// worker's URL. All go through one policy, `typstream`, so a page allows it
// with `trusted-types typstream`. It lives here because @typstream/dom and
// @typstream/engine both need it, and a page can create a policy name only
// once (unless its CSP says 'allow-duplicates').

interface Policy {
  createHTML(input: string): unknown;
  createScriptURL(input: string): unknown;
}

// The DOM's `trustedTypes`, declared here so the package needs no DOM types.
declare const trustedTypes: { createPolicy(name: string, rules: Record<keyof Policy, (s: string) => string>): Policy };

/** `undefined` until first use; `null` without Trusted Types, or when the page refused the name. */
let policy: Policy | null | undefined;

const typstreamPolicy = (): Policy | null => {
  if (policy === undefined) {
    policy = null;
    try {
      const pass = (s: string) => s;
      if (typeof trustedTypes === "object")
        policy = trustedTypes.createPolicy("typstream", { createHTML: pass, createScriptURL: pass });
    } catch {
      // The CSP doesn't list `typstream`, or the name is taken (another copy of
      // this package). Strings it is: a page without enforcement, or with a
      // default policy, still takes them.
    }
  }
  return policy;
};

/**
 * `html` as TrustedHTML from the `typstream` policy, where the page supports
 * Trusted Types; `html` itself otherwise. Typed as a string for `innerHTML`.
 * Only for markup parsed into a `<template>` and sanitized before it is shown.
 * @internal
 */
export const trustedHTML = (html: string): string => (typstreamPolicy()?.createHTML(html) ?? html) as string;

/**
 * `url` as TrustedScriptURL from the `typstream` policy, where the page
 * supports Trusted Types; `url` itself otherwise. Only for the engine worker.
 * @internal
 */
export const trustedScriptURL = (url: string): string => (typstreamPolicy()?.createScriptURL(url) ?? url) as string;
