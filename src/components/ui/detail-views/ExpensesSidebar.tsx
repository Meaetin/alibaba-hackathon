"use client";

import { useState } from "react";
import { ArrowRight, Plus, WalletMinimal } from "lucide-react";

import { ExpenseSummaryCard } from "./ExpenseSummaryCard";
import { TransactionCard, type SubTransaction } from "./TransactionCard";
import { PanelEmptyState } from "./PanelEmptyState";

export interface Expense {
  name: string;
  date: string;
  amount: string;
  subTransactions?: SubTransaction[];
}

interface ExpensesSidebarProps {
  expenses: Expense[];
  onAddExpense?: () => void;
}

function ExpensesSidebar({ expenses, onAddExpense }: ExpensesSidebarProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (expenses.length === 0) {
    return (
      <div className="expenses-empty-state-wrapper flex flex-1 h-full items-center justify-center mx-auto max-w-[440px]">
        <PanelEmptyState
          icon={WalletMinimal}
          title="No expenses added yet"
          description="Track your spending by adding expenses"
        >
          <button
            onClick={onAddExpense}
            className="panel-empty-state-action flex items-center gap-3 px-4 py-3.5 border-b border-edge hover:bg-surface-muted/50 transition-colors text-left"
          >
            <Plus className="size-5 text-content-secondary shrink-0" />
            <div className="panel-empty-state-action-text flex-1 min-w-0">
              <p className="type-body-2 font-medium text-content">Add expense</p>
              <p className="type-body-3 text-content-tertiary">Log a new expense manually</p>
            </div>
            <ArrowRight className="size-4 text-content-tertiary shrink-0" />
          </button>
        </PanelEmptyState>
      </div>
    );
  }

  // Compute total from expenses
  const total = expenses.reduce((sum, exp) => {
    const num = parseFloat(exp.amount.replace(/[^0-9.-]/g, ""));
    return sum + (isNaN(num) ? 0 : num);
  }, 0);

  return (
    <div className="expenses-sidebar-list flex flex-col gap-2 px-2 pb-3">
      <ExpenseSummaryCard
        currencies={[
          { code: "SGD", amount: `$${total.toFixed(2)}` },
          { code: "RM", amount: `$${(total * 3.11).toFixed(2)}` },
        ]}
      />
      {expenses.map((expense, i) => (
        <TransactionCard
          key={`expense-${i}`}
          name={expense.name}
          date={expense.date}
          amount={expense.amount}
          expanded={expandedIndex === i}
          onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
          subTransactions={expense.subTransactions}
          expandsUp={i === expenses.length - 1}
        />
      ))}
    </div>
  );
}

export { ExpensesSidebar };
export type { ExpensesSidebarProps };
