import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Wordmark } from "@/components/logo";
import { githubUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark /> },
    githubUrl,
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "llms.txt", url: "/llms.txt", external: true },
    ],
  };
}
