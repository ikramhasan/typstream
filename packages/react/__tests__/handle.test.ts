// TypstreamHandle's exports (#18): they forward to the current mount, whose
// exports leave out fit-width's page size, and fail clearly without one.
import type { MountedTypstream } from "@typstream/dom";
import { describe, expect, it, vi } from "vitest";
import { createHandle } from "../src/Typstream";

/** A mount with only what the handle calls. */
const fakeMount = (name: string) =>
  ({
    subscribe: () => () => {},
    exportPdf: vi.fn(async () => new TextEncoder().encode(`%PDF-${name}`)),
    exportHtml: vi.fn(async (options?: { title?: string }) => `<title>${options?.title ?? name}</title>`),
    exportSource: vi.fn(() => `= ${name}`),
  }) as unknown as MountedTypstream;

describe("TypstreamHandle exports", () => {
  it("forward to the current mount, with their options", async () => {
    const { handle, attach } = createHandle();
    const first = fakeMount("first");
    attach(first);
    expect(new TextDecoder().decode(await handle.exportPdf())).toBe("%PDF-first");
    await handle.exportPdf({ inputs: { showAnswers: "true" } });
    expect(first.exportPdf).toHaveBeenLastCalledWith({ inputs: { showAnswers: "true" } });
    expect(await handle.exportHtml({ title: "Quiz" })).toBe("<title>Quiz</title>");
    expect(first.exportHtml).toHaveBeenCalledWith({ title: "Quiz" });
    expect(handle.exportSource()).toBe("= first");
    // StrictMode's second mount, or a new engine: the handle follows it.
    attach(null);
    const second = fakeMount("second");
    attach(second);
    expect(handle.exportSource()).toBe("= second");
    expect(await handle.exportHtml()).toBe("<title>second</title>");
    expect(first.exportSource).toHaveBeenCalledTimes(1);
  });

  it("reject (PDF, HTML) or throw (source) before the component mounts and after it unmounts", async () => {
    const { handle, attach } = createHandle();
    await expect(handle.exportPdf()).rejects.toThrow("<Typstream> isn't mounted");
    await expect(handle.exportHtml()).rejects.toThrow("<Typstream> isn't mounted");
    expect(() => handle.exportSource()).toThrow("<Typstream> isn't mounted");
    attach(fakeMount("gone"));
    attach(null);
    // A promise either way: the error isn't thrown synchronously.
    const pdf = handle.exportPdf();
    expect(pdf).toBeInstanceOf(Promise);
    await expect(pdf).rejects.toThrow("<Typstream> isn't mounted");
    expect(() => handle.exportSource()).toThrow("<Typstream> isn't mounted");
  });

  it("pass the mount's errors through", async () => {
    const { handle, attach } = createHandle();
    const mount = fakeMount("failing");
    const error = Object.assign(new Error("export failed"), { reason: "diagnostics" });
    vi.mocked(mount.exportPdf).mockRejectedValueOnce(error);
    attach(mount);
    await expect(handle.exportPdf()).rejects.toBe(error);
  });
});
