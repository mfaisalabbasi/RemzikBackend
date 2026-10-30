import { Injectable, Logger } from '@nestjs/common';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as serviceAccount from '../config/firebase-service-account.json';

@Injectable()
export class FirebaseProvider {
  private readonly logger = new Logger(FirebaseProvider.name);

  constructor() {
    if (!getApps().length) {
      try {
        // Deep-clone the imported JSON to make it a fully mutable plain object
        const mutableServiceAccount = JSON.parse(
          JSON.stringify(serviceAccount),
        );

        initializeApp({
          credential: cert(mutableServiceAccount),
        });
        this.logger.log('Firebase Admin Initialized Successfully');
      } catch (error) {
        this.logger.error('Firebase Admin Initialization Failed:', error);
      }
    }
  }

  getMessaging() {
    return getMessaging();
  }
}
