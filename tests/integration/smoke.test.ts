import { describe, it, expect } from "vitest";
import { call, newActor } from "../helpers/api";
import * as userRoute from "@/app/api/user/route";
import * as categoriesRoute from "@/app/api/categories/route";

describe("integration harness", () => {
  it("registers, authenticates and lists per-user default categories", async () => {
    const a = await newActor("Asha");
    const me = await call(userRoute.GET, "GET", "/api/user", { as: a });
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(a.email);
    const cats = await call(categoriesRoute.GET, "GET", "/api/categories", { as: a });
    expect(cats.status).toBe(200);
    expect(cats.body.data.length).toBeGreaterThanOrEqual(24);
    expect(cats.body.data.every((c: { id: string }) => /^c[a-z0-9]{20,}$/.test(c.id))).toBe(true);
  });

  it("rejects anonymous requests with 401", async () => {
    const res = await call(userRoute.GET, "GET", "/api/user");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("UNAUTHORIZED");
  });
});
