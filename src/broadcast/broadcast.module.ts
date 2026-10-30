import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Broadcast } from './broadcast.entity';
import { BroadcastService } from './broadcast.service';
import { BroadcastGateway } from './broadcast.gateway';
import { User } from 'src/user/user.entity'; // 👈 1. Import User Entity (adjust relative path if needed)
import { FirebaseProvider } from '../notifications/firebase.provider'; // 👈 2. Import FirebaseProvider (adjust relative path if needed)

@Module({
  imports: [
    TypeOrmModule.forFeature([Broadcast, User]), // 👈 3. Add User repository here
  ],
  providers: [
    BroadcastService,
    BroadcastGateway,
    FirebaseProvider, // 👈 4. Provide FirebaseProvider
  ],
  exports: [BroadcastService, TypeOrmModule],
})
export class BroadcastModule {}
