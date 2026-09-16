'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { riskTier } from '@/lib/risk-registry';

type DynamicToolPart = Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }>;

interface TraceEntry {
  key: string;
  part: DynamicToolPart;
}

function collectTrace(messages: UIMessage[]): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'dynamic-tool') {
        entries.push({ key: `${message.id}-${part.toolCallId}`, part });
      }
    }
  }
  return entries;
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  const { part } = entry;
  const tier = riskTier(part.toolName);

  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tier === 'SAFE' ? 'secondary' : 'outline'} className="font-mono text-xs">
          {tier}
        </Badge>
        <span className="font-mono text-sm">
          {part.toolName}({JSON.stringify(part.input ?? {})})
        </span>
      </div>

      <div className="mt-1.5 pl-1">
        {part.state === 'approval-requested' && (
          <p className="text-xs text-muted-foreground">Checking...</p>
        )}

        {part.state === 'approval-responded' && (
          <p className="text-xs text-muted-foreground">
            <Badge variant={part.approval.approved ? 'secondary' : 'destructive'} className="mr-1.5">
              {part.approval.approved ? 'Approved' : 'Blocked'}
            </Badge>
            automatically
            {part.approval.reason ? ` - ${part.approval.reason}` : ''}
          </p>
        )}

        {part.state === 'output-available' && (
          <p className="font-mono text-xs text-muted-foreground">{JSON.stringify(part.output)}</p>
        )}

        {part.state === 'output-denied' && (
          <p className="text-xs text-destructive">
            <Badge variant="destructive" className="mr-1.5">
              {part.approval.isAutomatic ? 'Auto-blocked' : 'Blocked'}
            </Badge>
            {part.approval.reason ?? 'Not executed.'}
          </p>
        )}

        {part.state === 'output-error' && (
          <p className="text-xs text-destructive">Error: {part.errorText}</p>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { messages, sendMessage, setMessages, status, error, clearError } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');

  const trace = useMemo(() => collectTrace(messages), [messages]);
  // status is 'submitted' | 'streaming' | 'ready' | 'error' - only the
  // first two mean a request is actually in flight. Disabling on 'error'
  // too would lock the input with no way to retry and no visible reason.
  const busy = status === 'submitted' || status === 'streaming';
  const canSend = !busy;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SignalGuard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Qwen3 on a Snapdragon X Elite via GenieX, calling MCP tools with a safety gate in front
            of anything not read-only.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMessages([]);
            clearError();
          }}
        >
          New chat
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error.message || 'Something went wrong talking to the server.'}</span>
            <Button size="sm" variant="outline" onClick={() => clearError()}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTitle>Why this exists</AlertTitle>
        <AlertDescription>
          Ambiguous instructions can silently resolve to the wrong scope - &quot;remove other
          branches&quot; meaning local when an agent executes it as remote, with no confirmation
          before a destructive MCP tool call runs. Every tool call goes through two independent
          automatic checks before it executes - a separate, smaller classifier model that has no
          say in what to call next (only whether the call looks malicious), and an ambiguity check
          on anything not read-only - and every decision is logged in the trace panel. Try{' '}
          <span className="font-mono text-foreground">clean up the other branches</span> below.
        </AlertDescription>
      </Alert>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="flex min-h-[420px] flex-col">
          <CardHeader>
            <CardTitle className="text-base">Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <ScrollArea className="flex-1 pr-2">
              <div className="flex flex-col gap-3">
                {messages.map(message => (
                  <div key={message.id} className="text-sm">
                    <span className="font-medium">{message.role === 'user' ? 'You: ' : 'Assistant: '}</span>
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return <span key={i}>{part.text}</span>;
                      }
                      if (part.type === 'dynamic-tool') {
                        return (
                          <span key={i} className="text-muted-foreground">
                            {' '}
                            [used {part.toolName}]
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault();
                if (input.trim() && canSend) {
                  sendMessage({ text: input });
                  setInput('');
                }
              }}
            >
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="e.g. Check whether the Arduino is connected"
                disabled={!canSend}
              />
              <Button type="submit" disabled={!canSend || !input.trim()}>
                Send
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="flex min-h-[420px] flex-col">
          <CardHeader>
            <CardTitle className="text-base">SignalGuard trace</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every tool call, its risk tier, and its approval decision - in order.
            </p>
          </CardHeader>
          <CardContent className="flex-1">
            <ScrollArea className="h-full">
              {trace.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tool calls yet.</p>
              ) : (
                trace.map(entry => <TraceRow key={entry.key} entry={entry} />)
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
