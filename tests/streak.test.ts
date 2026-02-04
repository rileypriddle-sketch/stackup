import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const DAY_BLOCKS = 144;

const mineDays = (days: number) => {
  simnet.mineEmptyBlocks(DAY_BLOCKS * days);
};

describe("streak contract", () => {
  it("starts a streak at 1 on first claim", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_1")!;

    const claim = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim.result).toBeOk();

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(wallet.address)],
      wallet.address
    );
    expect(streak.result).toBeUint(1);
  });

  it("rejects double claim on the same day", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_2")!;

    const claim1 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim1.result).toBeOk();

    const claim2 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim2.result).toBeErr(Cl.uint(100));
  });

  it("increments streak when claimed the next day", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_3")!;

    const claim1 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim1.result).toBeOk();

    mineDays(1);

    const claim2 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim2.result).toBeOk();

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(wallet.address)],
      wallet.address
    );
    expect(streak.result).toBeUint(2);
  });

  it("resets streak after a missed day", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_4")!;

    const claim1 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim1.result).toBeOk();

    mineDays(2);

    const claim2 = simnet.callPublicFn("streak", "claim", [], wallet.address);
    expect(claim2.result).toBeOk();

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(wallet.address)],
      wallet.address
    );
    expect(streak.result).toBeUint(1);
  });

  it("mints the 7-day badge", () => {
    const accounts = simnet.getAccounts();
    const wallet = accounts.get("wallet_5")!;

    for (let day = 1; day <= 7; day += 1) {
      const claim = simnet.callPublicFn("streak", "claim", [], wallet.address);
      expect(claim.result).toBeOk();
      if (day < 7) {
        mineDays(1);
      }
    }

    const hasBadge = simnet.callReadOnlyFn(
      "streak",
      "has-badge",
      [Cl.principal(wallet.address)],
      wallet.address
    );
    expect(hasBadge.result).toBeBool(true);
  });
});
