import { Desktop } from "@/desktop/components/desktop";
import { getCurrentEmployee } from "@/services/employee-service";

export default function Home() {
  const employee = getCurrentEmployee();
  return <Desktop employee={employee} />;
}
