export interface Settlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

export interface MemberBalance {
  memberId: string;
  memberName: string;
  totalPaid: number;
  totalOwed: number;
  balance: number; // positive = owed money, negative = owes money
}

interface Expense {
  id: string;
  paid_by: string;
  amount: number;
  split_among: string[];
}

interface Member {
  id: string;
  name: string;
}

export interface SettlementRecord {
  id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  settled_by: string;
  created_at: string;
}

export function calculateBalances(
  expenses: Expense[],
  members: Member[]
): MemberBalance[] {
  const balances = new Map<string, MemberBalance>();

  members.forEach((m) => {
    balances.set(m.id, {
      memberId: m.id,
      memberName: m.name,
      totalPaid: 0,
      totalOwed: 0,
      balance: 0,
    });
  });

  expenses.forEach((expense) => {
    const splitMembers = expense.split_among.length > 0 ? expense.split_among : members.map((m) => m.id);
    const share = expense.amount / splitMembers.length;

    const payer = balances.get(expense.paid_by);
    if (payer) payer.totalPaid += expense.amount;

    splitMembers.forEach((memberId) => {
      const member = balances.get(memberId);
      if (member) member.totalOwed += share;
    });
  });

  balances.forEach((b) => {
    b.balance = b.totalPaid - b.totalOwed;
  });

  return Array.from(balances.values());
}

export function calculateSettlements(
  expenses: Expense[],
  members: Member[]
): Settlement[] {
  const balances = calculateBalances(expenses, members);
  const settlements: Settlement[] = [];

  const debtors = balances.filter((b) => b.balance < -0.01).map((b) => ({ ...b }));
  const creditors = balances.filter((b) => b.balance > 0.01).map((b) => ({ ...b }));

  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].balance, creditors[j].balance);
    if (amount > 0.01) {
      settlements.push({
        from: debtors[i].memberId,
        fromName: debtors[i].memberName,
        to: creditors[j].memberId,
        toName: creditors[j].memberName,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[i].balance += amount;
    creditors[j].balance -= amount;
    if (Math.abs(debtors[i].balance) < 0.01) i++;
    if (Math.abs(creditors[j].balance) < 0.01) j++;
  }

  return settlements;
}

export function adjustBalancesForSettlements(
  balances: MemberBalance[],
  settlementRecords: SettlementRecord[],
  members: Member[]
): MemberBalance[] {
  const adjusted = balances.map((b) => ({ ...b }));
  const balanceMap = new Map(adjusted.map((b) => [b.memberId, b]));

  settlementRecords.forEach((s) => {
    const from = balanceMap.get(s.from_member_id);
    const to = balanceMap.get(s.to_member_id);
    if (from && to) {
      from.balance += s.amount;
      to.balance -= s.amount;
    }
  });

  return adjusted;
}

export function calculateRemainingSettlements(
  adjustedBalances: MemberBalance[]
): Settlement[] {
  const settlements: Settlement[] = [];

  const debtors = adjustedBalances.filter((b) => b.balance < -0.01).map((b) => ({ ...b }));
  const creditors = adjustedBalances.filter((b) => b.balance > 0.01).map((b) => ({ ...b }));

  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].balance, creditors[j].balance);
    if (amount > 0.01) {
      settlements.push({
        from: debtors[i].memberId,
        fromName: debtors[i].memberName,
        to: creditors[j].memberId,
        toName: creditors[j].memberName,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[i].balance += amount;
    creditors[j].balance -= amount;
    if (Math.abs(debtors[i].balance) < 0.01) i++;
    if (Math.abs(creditors[j].balance) < 0.01) j++;
  }

  return settlements;
}

/**
 * Scales `parts` so they add up to `total` while keeping their ratios
 * (e.g. spreading a discount across split groups). Leftover paise from
 * rounding go to the largest part so the result sums to `total` exactly.
 */
export function scaleToTotal(parts: number[], total: number): number[] {
  const partsCents = parts.map((p) => Math.round(p * 100));
  const sumCents = partsCents.reduce((a, b) => a + b, 0);
  if (sumCents === 0) return parts.map(() => 0);
  const totalCents = Math.round(total * 100);
  const scaled = partsCents.map((p) => Math.round((p * totalCents) / sumCents));
  const largest = scaled.indexOf(Math.max(...scaled));
  scaled[largest] += totalCents - scaled.reduce((a, b) => a + b, 0);
  return scaled.map((c) => c / 100);
}
