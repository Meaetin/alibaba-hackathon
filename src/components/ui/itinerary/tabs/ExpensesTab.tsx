"use client";

import { cn } from "@/lib/utils";
import { ExpensesSidebar, type Expense } from "@/components/ui/detail-views/ExpensesSidebar";

interface ExpensesTabProps {
  expenses: Expense[];
  onAddExpense?: () => void;
  className?: string;
}

export function ExpensesTab({ expenses, onAddExpense, className }: ExpensesTabProps) {
  return (
    <div data-slot="expenses-tab" className={cn("expenses-tab-root flex flex-col gap-3 h-full", className)}>
      {/* Expenses List */}
      <ExpensesSidebar expenses={expenses} onAddExpense={onAddExpense} />
    </div>
  );
}
