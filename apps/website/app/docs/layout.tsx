import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const { links: _links, ...options } = baseOptions();
  return (
    <DocsLayout tree={source.getPageTree()} {...options}>
      {children}
    </DocsLayout>
  );
}
