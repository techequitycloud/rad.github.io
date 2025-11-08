import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import GettingStarted from "./pages/docs/GettingStarted";
import AdminGuide from "./pages/docs/guides/AdminGuide";
import PartnerGuide from "./pages/docs/guides/PartnerGuide";
import AgentGuide from "./pages/docs/guides/AgentGuide";
import UserGuide from "./pages/docs/guides/UserGuide";
import Deployments from "./pages/docs/features/Deployments";
import Modules from "./pages/docs/features/Modules";
import Publishing from "./pages/docs/features/Publishing";
import Credits from "./pages/docs/billing/Credits";
import Subscriptions from "./pages/docs/billing/Subscriptions";
import Transactions from "./pages/docs/billing/Transactions";
import Settings from "./pages/docs/admin/Settings";
import Users from "./pages/docs/admin/Users";
import Notifications from "./pages/docs/admin/Notifications";
import Support from "./pages/docs/Support";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/docs"} component={GettingStarted} />
      <Route path={"/docs/getting-started"} component={GettingStarted} />
      <Route path={"/docs/guides/admin"} component={AdminGuide} />
      <Route path={"/docs/guides/partner"} component={PartnerGuide} />
      <Route path={"/docs/guides/agent"} component={AgentGuide} />
      <Route path={"/docs/guides/user"} component={UserGuide} />
      <Route path={"/docs/features/deployments"} component={Deployments} />
      <Route path={"/docs/features/modules"} component={Modules} />
      <Route path={"/docs/features/publishing"} component={Publishing} />
      <Route path={"/docs/billing/credits"} component={Credits} />
      <Route path={"/docs/billing/subscriptions"} component={Subscriptions} />
      <Route path={"/docs/billing/transactions"} component={Transactions} />
      <Route path={"/docs/admin/settings"} component={Settings} />
      <Route path={"/docs/admin/users"} component={Users} />
      <Route path={"/docs/admin/notifications"} component={Notifications} />
      <Route path={"/docs/support"} component={Support} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
