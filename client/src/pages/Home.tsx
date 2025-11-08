import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Cloud, Settings, Package, ArrowRight, Github, BookOpen } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">RAD Platform</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/docs">
              <a className="text-sm font-medium hover:text-primary transition-colors">
                Documentation
              </a>
            </Link>
            <a 
              href="https://github.com/techequitycloud/rad.github.io" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-1"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-primary/10 to-background py-20 md:py-32">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              RAD Platform
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground">
              Enterprise-grade infrastructure deployment platform for technical teams and partners
            </p>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Deploy multi-cloud infrastructure with Terraform-based automation, comprehensive monitoring, 
              and enterprise-grade management capabilities.
            </p>
            <div className="flex gap-4 justify-center pt-4">
              <Link href="/docs">
                <Button size="lg" className="gap-2">
                  <BookOpen className="h-5 w-5" />
                  Documentation
                </Button>
              </Link>
              <Link href="/docs/getting-started">
                <Button size="lg" variant="outline" className="gap-2">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="py-20 md:py-32">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="h-48 -mx-6 -mt-6 mb-4 rounded-t-lg overflow-hidden bg-muted">
                  <img 
                    src="/multi-cloud.webp" 
                    alt="Multi-Cloud Infrastructure" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <Cloud className="h-5 w-5 text-primary" />
                  Multi-Cloud Infrastructure as Code
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Deploy infrastructure across AWS, Azure, and GCP using Terraform-based automation. 
                  Pre-configured secure landing zones and compliance templates ensure your deployments 
                  meet enterprise standards from day one. Real-time monitoring with Cloud Build integration 
                  provides complete visibility into your deployment pipeline.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="h-48 -mx-6 -mt-6 mb-4 rounded-t-lg overflow-hidden bg-muted">
                  <img 
                    src="/terraform.jpg" 
                    alt="Enterprise Management" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  Enterprise-Grade Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Implement role-based access control with Google Cloud Identity integration. 
                  Credit-based resource allocation and billing provide granular cost management. 
                  Comprehensive audit trails and deployment analytics give you complete oversight 
                  of your infrastructure operations and spending.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="h-48 -mx-6 -mt-6 mb-4 rounded-t-lg overflow-hidden bg-muted">
                  <img 
                    src="/deployment.jpg" 
                    alt="Extensible Modules" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Extensible Module System
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Leverage GitHub-integrated custom module repositories for your organization's 
                  specific needs. Access platform and partner module catalogs for common infrastructure 
                  patterns. Automated module publishing and version control streamline your deployment 
                  workflow and ensure consistency across teams.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer Navigation */}
      <section className="border-t bg-muted/30 py-16">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-12">
            <div>
              <h3 className="font-semibold text-lg mb-4">Documentation</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/docs/getting-started">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Getting Started
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/guides/admin">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Administrator Guide
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/guides/partner">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Partner Guide
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/guides/user">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      User Guide
                    </a>
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-4">Features</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/docs/features/deployments">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Deployments
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/features/modules">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Modules
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/features/billing">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Billing & Credits
                    </a>
                  </Link>
                </li>
                <li>
                  <Link href="/docs/admin/settings">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Administration
                    </a>
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-4">Resources</h3>
              <ul className="space-y-2">
                <li>
                  <a 
                    href="https://github.com/techequitycloud/rad.github.io" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <Link href="/docs/support">
                    <a className="text-muted-foreground hover:text-primary transition-colors">
                      Support
                    </a>
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Tech Equity Cloud. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
