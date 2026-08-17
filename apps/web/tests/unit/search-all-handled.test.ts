/**
 * @jest-environment node
 */
import { allHandled } from "@/lib/search/allHandled";

describe("allHandled", () => {
  it("resolves to a tuple of values like Promise.all", async () => {
    const result = await allHandled([
      Promise.resolve(1),
      Promise.resolve("two"),
      Promise.resolve(null),
    ]);

    expect(result).toEqual([1, "two", null]);
  });

  it("accepts non-promise values alongside promises", async () => {
    expect(await allHandled([Promise.resolve(1), 2])).toEqual([1, 2]);
  });

  it("rejects with the first failure, exactly as Promise.all does", async () => {
    const boom = new Error("boom");

    await expect(
      allHandled([Promise.resolve(1), Promise.reject(boom), Promise.resolve(3)])
    ).rejects.toBe(boom);
  });

  // #928: Promise.all settles on the first rejection and leaves its still-in-flight
  // siblings without a handler. When they also reject, Node reports each as an
  // unhandledRejection — 9 of them showed up while reproducing the pool timeout.
  //
  // That behaviour is deliberately NOT asserted here. Jest installs its own
  // `unhandledRejection` handling, so a `process.on("unhandledRejection", ...)`
  // spy never fires inside a test and would pass whether or not the guard works.
  // It is verified against a real container instead (see the PR for #928).
  //
  // What this case does check is that the sibling still settles rather than
  // being abandoned, which is the observable half of the behaviour.
  it("still settles a slower sibling after an earlier one rejects", async () => {
    let slowSettled = false;
    const fast = Promise.reject(new Error("fast"));
    const slow = new Promise((_resolve, reject) =>
      setTimeout(() => {
        slowSettled = true;
        reject(new Error("slow"));
      }, 5)
    );

    await expect(allHandled([fast, slow])).rejects.toThrow("fast");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(slowSettled).toBe(true);
  });
});
