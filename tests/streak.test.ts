import { beforeEach, describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const DAY_BLOCKS = 144;

const mineDays = (days: number) => {
  simnet.mineEmptyBlocks(DAY_BLOCKS * days);
};

const getWalletAddress = (preferred?: string) => {
  const accounts = simnet.getAccounts() as Map<string, string>;
  const fallback = Array.from(accounts.values())[0];
  const wallet =
    (preferred ? accounts.get(preferred) : undefined) ??
    accounts.get("deployer") ??
    fallback;

  if (!wallet) {
    throw new Error("No simnet accounts available");
  }

  return wallet;
};

beforeEach(() => {
  // Ensure the next claim is on a different day to avoid same-day rejections
  // and reset streak back to 1 if a previous day was missed.
  mineDays(2);
});

describe("streak contract", () => {
  it("starts a streak at 1 on first claim", () => {
    const address = getWalletAddress("wallet_1");

    const claim = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim.result).toHaveClarityType(ClarityType.ResponseOk);

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(address)],
      address
    );
    expect(streak.result).toBeUint(1);
  });

  it("rejects double claim on the same day", () => {
    const address = getWalletAddress("wallet_2");

    const claim1 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim1.result).toHaveClarityType(ClarityType.ResponseOk);

    const claim2 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim2.result).toBeErr(Cl.uint(100));
  });

  it("increments streak when claimed the next day", () => {
    const address = getWalletAddress("wallet_3");

    const claim1 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim1.result).toHaveClarityType(ClarityType.ResponseOk);

    mineDays(1);

    const claim2 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim2.result).toHaveClarityType(ClarityType.ResponseOk);

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(address)],
      address
    );
    expect(streak.result).toBeUint(2);
  });

  it("resets streak after a missed day", () => {
    const address = getWalletAddress("wallet_4");

    const claim1 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim1.result).toHaveClarityType(ClarityType.ResponseOk);

    mineDays(2);

    const claim2 = simnet.callPublicFn("streak", "claim", [], address);
    expect(claim2.result).toHaveClarityType(ClarityType.ResponseOk);

    const streak = simnet.callReadOnlyFn(
      "streak",
      "get-streak",
      [Cl.principal(address)],
      address
    );
    expect(streak.result).toBeUint(1);
  });

  it("mints the 7-day badge", () => {
    const address = getWalletAddress("wallet_5");

    for (let day = 1; day <= 7; day += 1) {
      const claim = simnet.callPublicFn("streak", "claim", [], address);
      expect(claim.result).toHaveClarityType(ClarityType.ResponseOk);
      if (day < 7) {
        mineDays(1);
      }
    }

    const hasBadge = simnet.callReadOnlyFn(
      "streak",
      "has-badge",
      [Cl.principal(address)],
      address
    );
    expect(hasBadge.result).toBeBool(true);
  });
});
