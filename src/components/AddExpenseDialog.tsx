import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { scaleToTotal } from "@/lib/splitCalculator";
import { CalendarIcon, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Member { id: string; name: string; }
// `everyone` groups (Common) always split across all members, so they have no member picker
interface SplitGroup { key: string; name: string; amount: string; members: string[]; everyone?: boolean; }
interface Expense { id: string; paid_by: string; description: string; amount: number; split_among: string[]; category?: string | null; created_at?: string; }

const defaultGroups = (): SplitGroup[] => [
  { key: crypto.randomUUID(), name: "Veg", amount: "", members: [] },
  { key: crypto.randomUUID(), name: "Non-veg", amount: "", members: [] },
  { key: crypto.randomUUID(), name: "Common", amount: "", members: [], everyone: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

interface AddExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  memberId: string;
  memberName: string;
  members: Member[];
  editExpense: Expense | null;
  onSaved: () => void;
}

export function AddExpenseDialog({
  open, onOpenChange, groupId, memberId, memberName, members, editExpense, onSaved,
}: AddExpenseDialogProps) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Discount can be entered as the amount actually paid or as a percentage; the other is derived
  const [discount, setDiscount] = useState<{ kind: "paid" | "percent"; value: string }>({ kind: "paid", value: "" });
  const [paidBy, setPaidBy] = useState(memberId);
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<"equal" | "groups">("equal");
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [category, setCategory] = useState<string>("");
  const [date, setDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editExpense) {
      setDescription(editExpense.description);
      setAmount(String(editExpense.amount));
      setDiscount({ kind: "paid", value: "" });
      setPaidBy(editExpense.paid_by);
      setSplitAmong(editExpense.split_among.length > 0 ? editExpense.split_among : members.map((m) => m.id));
      setCategory(editExpense.category || "");
      setDate(editExpense.created_at ? new Date(editExpense.created_at) : new Date());
    } else {
      setDescription("");
      setAmount("");
      setDiscount({ kind: "paid", value: "" });
      setPaidBy(memberId);
      setSplitAmong(members.map((m) => m.id));
      setCategory("");
      setDate(new Date());
    }
    setSplitMode("equal");
    setGroups(defaultGroups());
  }, [editExpense, open, memberId, members]);

  const toggleMember = (id: string) => {
    setSplitAmong((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const updateGroup = (key: string, patch: Partial<SplitGroup>) => {
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  };

  const toggleGroupMember = (key: string, id: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.key === key
          ? { ...g, members: g.members.includes(id) ? g.members.filter((m) => m !== id) : [...g.members, id] }
          : g
      )
    );
  };

  const groupMembers = (g: SplitGroup) => (g.everyone ? members.map((m) => m.id) : g.members);

  const isGroupMode = splitMode === "groups" && !editExpense;
  const activeGroups = groups.filter((g) => Number(g.amount) > 0);
  const billAmount = isGroupMode
    ? round2(activeGroups.reduce((sum, g) => sum + Number(g.amount), 0))
    : Number(amount) || 0;
  const hasDiscount = discount.value !== "";
  const finalAmount = !hasDiscount
    ? billAmount
    : discount.kind === "paid"
      ? Number(discount.value) || 0
      : round2(billAmount * (1 - (Number(discount.value) || 0) / 100));
  const discountPercent = billAmount > 0 ? ((billAmount - finalAmount) / billAmount) * 100 : 0;
  const validPaid = finalAmount > 0 && finalAmount <= billAmount;

  // Each group's share of what was actually paid (discount spread proportionally)
  const groupShares = isGroupMode && validPaid
    ? scaleToTotal(activeGroups.map((g) => Number(g.amount)), finalAmount)
    : [];
  const shareByGroup = new Map(activeGroups.map((g, i) => [g.key, groupShares[i]]));
  const perPerson = new Map<string, number>();
  activeGroups.forEach((g, i) => {
    const ids = groupMembers(g);
    if (!groupShares[i] || ids.length === 0) return;
    ids.forEach((id) => perPerson.set(id, (perPerson.get(id) ?? 0) + groupShares[i] / ids.length));
  });

  const saveGroups = async () => {
    if (activeGroups.length === 0) {
      toast({ title: "Enter an amount for at least one group", variant: "destructive" });
      return;
    }
    const invalid = activeGroups.find((g) => !g.name.trim() || groupMembers(g).length === 0);
    if (invalid) {
      toast({ title: `Give "${invalid.name.trim() || "Unnamed"}" group a name and at least one member`, variant: "destructive" });
      return;
    }
    if (!validPaid) {
      toast({ title: "Discount must be less than 100% and paid amount at most the bill", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const base = description.trim() || "Untitled";
      const rows = activeGroups.map((g, i) => ({
        group_id: groupId,
        paid_by: paidBy,
        description: `${base} (${g.name.trim()})`,
        amount: groupShares[i],
        split_among: groupMembers(g),
        category: category || null,
        created_at: date.toISOString(),
        created_by: memberId,
      }));
      const { error } = await supabase.from("expenses").insert(rows);
      if (error) throw error;
      await supabase.from("activity_log").insert(
        rows.map((r) => ({
          group_id: groupId, member_id: memberId, action: "EXPENSE_CREATED",
          details: `${memberName} added "${r.description}" (₹${r.amount.toFixed(2)})`,
        }))
      );
      toast({ title: `Added ${rows.length} expense${rows.length > 1 ? "s" : ""}` });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: "Error saving expense", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (isGroupMode) return saveGroups();
    if (!amount || billAmount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!validPaid) {
      toast({ title: "Discount must be less than 100% and paid amount at most the bill", variant: "destructive" });
      return;
    }
    if (splitAmong.length === 0) {
      toast({ title: "Select at least one member to split with", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const expenseData = {
        group_id: groupId,
        paid_by: paidBy,
        description: description.trim() || "Untitled",
        amount: finalAmount,
        split_among: splitAmong,
        category: category || null,
        created_at: date.toISOString(),
      };

      if (editExpense) {
        const { error } = await supabase.from("expenses").update(expenseData).eq("id", editExpense.id);
        if (error) throw error;
        await supabase.from("activity_log").insert({
          group_id: groupId, member_id: memberId, action: "EXPENSE_UPDATED",
          details: `${memberName} updated "${expenseData.description}" to ₹${finalAmount.toFixed(2)}`,
        });
        toast({ title: "Expense updated" });
      } else {
        const { error } = await supabase.from("expenses").insert({ ...expenseData, created_by: memberId });
        if (error) throw error;
        await supabase.from("activity_log").insert({
          group_id: groupId, member_id: memberId, action: "EXPENSE_CREATED",
          details: `${memberName} added "${expenseData.description}" (₹${finalAmount.toFixed(2)})`,
        });
        toast({ title: "Expense added" });
      }

      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: "Error saving expense", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editExpense ? "Edit Expense" : "Add Expense"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="e.g. Dinner, Uber, Groceries"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>
          {!editExpense && (
            <Tabs value={splitMode} onValueChange={(v) => setSplitMode(v as "equal" | "groups")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="equal">Split equally</TabsTrigger>
                <TabsTrigger value="groups">Split by groups</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {isGroupMode ? (
            <div className="space-y-3">
              {groups.map((g) => {
                const amt = Number(g.amount) || 0;
                const share = shareByGroup.get(g.key);
                const count = groupMembers(g).length;
                return (
                  <div key={g.key} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      {g.everyone ? (
                        <span className="flex-1 text-sm font-medium">{g.name}</span>
                      ) : (
                        <Input
                          className="h-8"
                          placeholder="Group name"
                          value={g.name}
                          onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                          maxLength={40}
                        />
                      )}
                      <Input
                        className="h-8 w-28 shrink-0"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="₹ 0.00"
                        value={g.amount}
                        onChange={(e) => updateGroup(g.key, { amount: e.target.value })}
                      />
                      {g.everyone ? (
                        <span className="h-8 w-8 shrink-0" />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => setGroups((prev) => prev.filter((x) => x.key !== g.key))}
                          aria-label={`Remove ${g.name || "group"}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {g.everyone ? (
                      <p className="text-xs text-muted-foreground">Shared by all {members.length} members</p>
                    ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {members.map((m) => {
                        const selected = g.members.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleGroupMember(g.key, m.id)}
                            className={cn(
                              "text-xs rounded-full border px-2.5 py-1 transition-colors",
                              selected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:bg-muted/50"
                            )}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                    )}
                    {amt > 0 && count > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {share !== undefined && share < amt ? (
                          <>
                            <span className="font-semibold text-foreground">₹{(share / count).toFixed(2)}</span> each
                            <span className="line-through ml-2">₹{(amt / count).toFixed(2)}</span>
                          </>
                        ) : (
                          <>₹{(amt / count).toFixed(2)} each</>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setGroups((prev) => {
                    // Keep Common last
                    const newGroup = { key: crypto.randomUUID(), name: "", amount: "", members: [] };
                    const common = prev.findIndex((x) => x.everyone);
                    return common === -1 ? [...prev, newGroup] : [...prev.slice(0, common), newGroup, ...prev.slice(common)];
                  })
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add group
              </Button>
              <p className="text-sm text-muted-foreground">
                Bill total: <span className="font-semibold text-foreground">₹{billAmount.toFixed(2)}</span>
              </p>
            </div>
          ) : (
          <div>
            <Label>Bill amount (₹)</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          )}
          <div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <Label>Paid amount (₹) <span className="text-muted-foreground text-xs">(if discounted)</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Same as bill"
                  value={discount.kind === "paid" ? discount.value : hasDiscount && validPaid ? finalAmount.toFixed(2) : ""}
                  onChange={(e) => setDiscount({ kind: "paid", value: e.target.value })}
                />
              </div>
              <div className="w-24">
                <Label>Discount %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={discount.kind === "percent" ? discount.value : hasDiscount && validPaid ? String(round2(discountPercent)) : ""}
                  onChange={(e) => setDiscount({ kind: "percent", value: e.target.value })}
                />
              </div>
            </div>
            {hasDiscount && validPaid && (
              <p className="text-xs text-muted-foreground mt-1">
                Discount: <span className="font-semibold text-foreground">{discountPercent.toFixed(2)}%</span> (₹{(billAmount - finalAmount).toFixed(2)} off)
              </p>
            )}
          </div>
          <div>
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label>Category <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.icon} {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Paid by</Label>
            <Select value={paidBy} onValueChange={setPaidBy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isGroupMode ? (
            perPerson.size > 0 && (
              <div className="border border-border rounded-lg p-3">
                <p className="text-sm font-medium mb-2">Each person pays</p>
                <div className="space-y-1">
                  {members.filter((m) => perPerson.has(m.id)).map((m) => (
                    <div key={m.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{m.name}</span>
                      <span className="font-semibold">₹{perPerson.get(m.id)!.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Split among</Label>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSplitAmong(members.map((m) => m.id))}>
                  Select All
                </button>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setSplitAmong([])}>
                  None
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded-lg p-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                  <Checkbox checked={splitAmong.includes(m.id)} onCheckedChange={() => toggleMember(m.id)} />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {splitAmong.length} of {members.length} selected
            </p>
          </div>
          {splitAmong.length > 0 && finalAmount > 0 && (
            <p className="text-sm text-muted-foreground">
              Each person pays: <span className="font-semibold text-foreground">₹{(finalAmount / splitAmong.length).toFixed(2)}</span>
              {finalAmount < billAmount && (
                <span className="line-through ml-2">₹{(billAmount / splitAmong.length).toFixed(2)}</span>
              )}
            </p>
          )}
            </>
          )}
          <Button onClick={handleSave} disabled={loading} className="w-full">
            {loading
              ? "Saving..."
              : editExpense
                ? "Update Expense"
                : isGroupMode && activeGroups.length > 1
                  ? `Add ${activeGroups.length} Expenses`
                  : "Add Expense"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
