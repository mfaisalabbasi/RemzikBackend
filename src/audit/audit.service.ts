import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm'; // ✅ Added EntityManager
import { AuditLog } from './audit.entity';
import { AdminAction } from './enums/audit-action.enum';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * ✅ FIXED: Now handles transactions (The 2nd Argument Fix)
   * GLOBAL LOG METHOD
   * @param data.adminId - The ID of the person performing the action
   * @param data.targetId - The ID of the object being affected
   * @param manager - Optional transaction manager
   */
  async log(
    data: {
      adminId: string;
      targetId: string;
      action: AdminAction;
      reason?: string;
    },
    manager?: EntityManager, // ✅ Added optional manager
  ) {
    // Switch to transaction repo if manager is present, otherwise use standard repo
    const repo = manager ? manager.getRepository(AuditLog) : this.auditRepo;

    const log = repo.create(data);
    return await repo.save(log);
  }

  async findRecent() {
    return this.auditRepo.find({
      order: { createdAt: 'DESC' },
      take: 5, // ✅ Limit to 5 at the database level
    });
  }

  async findAll(action?: AdminAction) {
    return this.auditRepo.find({
      where: action ? { action } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findLatest(): Promise<AuditLog | null> {
    return this.auditRepo.findOne({
      where: {}, // We want any record
      order: {
        createdAt: 'DESC', // Sort by newest first
      },
    });
  }

  async findByTarget(targetId: string) {
    return this.auditRepo.find({
      where: { targetId },
      order: { createdAt: 'DESC' },
    });
  }
}
