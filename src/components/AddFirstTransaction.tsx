"use client";

import { useTransactionSheet } from "./TransactionSheet";
import { Button } from "./ui/primitives";

export function AddFirstTransaction() {
  const { openCreate } = useTransactionSheet();
  return <Button variant="soft" size="sm" className="h-10 px-4 text-[14px]" onClick={() => openCreate()}>Добавить трату</Button>;
}
