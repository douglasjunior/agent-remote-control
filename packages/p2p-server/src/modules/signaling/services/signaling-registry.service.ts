import { Injectable } from '@nestjs/common';

import type { RegisteredHost, SignalingSession } from '../models/signaling-session.model.js';
import type { HostSocket } from '../ports/signaling-transport.port.js';


/** The hosts online and the sessions being negotiated, in memory: a restart only makes hosts and browsers reconnect. */
@Injectable()
export class SignalingRegistryService {
  private readonly hosts = new Map<string, RegisteredHost>();
  private readonly sessions = new Map<string, SignalingSession>();

  host(instanceId: string): RegisteredHost | undefined {
    return this.hosts.get(instanceId);
  }

  setHost(host: RegisteredHost): void {
    this.hosts.set(host.instanceId, host);
  }

  /** Removes the host and returns its sessions, when the socket still holds its instance. */
  removeHost(socket: HostSocket): readonly SignalingSession[] {
    const host = [...this.hosts.values()].find(candidate => candidate.socket === socket);
    if (!host) {
      return [];
    }
    this.hosts.delete(host.instanceId);
    const sessions = [...this.sessions.values()].filter(session => session.instanceId === host.instanceId);
    sessions.forEach(session => this.sessions.delete(session.id));
    return sessions;
  }

  session(id: string): SignalingSession | undefined {
    return this.sessions.get(id);
  }

  addSession(session: SignalingSession): void {
    this.sessions.set(session.id, session);
  }

  markOffered(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.set(id, { ...session, offered: true });
    }
  }

  removeSession(id: string): SignalingSession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }

  sessionCount(instanceId: string): number {
    return [...this.sessions.values()].filter(session => session.instanceId === instanceId).length;
  }
}
