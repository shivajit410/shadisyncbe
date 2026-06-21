import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // Only handle API routes
  if (request.nextUrl.pathname.startsWith('/api')) {
    // Check request origin, default to * or request origin
    const origin = request.headers.get('origin') || '*';
    
    // Create custom headers object
    const corsHeaders = {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,DELETE,PATCH,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
    };

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Continue with normal request and add headers
    const response = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
