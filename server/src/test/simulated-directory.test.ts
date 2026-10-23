import { describe, expect, it } from "bun:test";
import { SimulatedDirectoryClient } from "../lib/google-workspace/simulated-directory-client";

describe("the simulated Google", () => {
  const make = (client: SimulatedDirectoryClient, email: string) =>
    client.createUser({ primaryEmail: email, givenName: "A", familyName: "B", password: "Abcdefgh12345678" });

  it("gives ids that do not repeat after a restart, so links made earlier never collide", async () => {
    const first = await make(new SimulatedDirectoryClient(), "a@millennia21.id");
    // A restart is a new client whose counter starts again.
    const afterRestart = await make(new SimulatedDirectoryClient(), "b@millennia21.id");
    expect(first.id).toStartWith("simulated-");
    expect(afterRestart.id).toStartWith("simulated-");
    expect(afterRestart.id).not.toBe(first.id);
  });

  it("gives different ids to accounts made by the same client", async () => {
    const client = new SimulatedDirectoryClient();
    const one = await make(client, "a@millennia21.id");
    const two = await make(client, "b@millennia21.id");
    expect(one.id).not.toBe(two.id);
  });
});
