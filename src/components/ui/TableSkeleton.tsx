import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

interface TableSkeletonProps {
  rows?: number;
  cols: number;
}

export function TableSkeleton({ rows = 6, cols }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton
                className="h-4 rounded"
                style={{ width: j === 0 ? "70%" : j === cols - 1 ? "40%" : "55%" }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}