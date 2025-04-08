// Add this as a new component, perhaps in a file like GiftMessageModal.tsx
import React, { FunctionComponent } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { Modal, ModalHeader } from '../ui/modal';
import { LoadingOverlay } from '../ui/loading';
import { TranslatedString } from '@bigcommerce/checkout/locale';

interface GiftMessageModalProps {
    isOpen: boolean;
    isLoading: boolean;
    initialMessage?: string;
    onSubmit: (message: string) => void;
    onRequestClose: () => void;
}

const GiftMessageModal: FunctionComponent<GiftMessageModalProps> = ({
    isOpen,
    isLoading,
    initialMessage = '',
    onSubmit,
    onRequestClose
}) => {
    const [editedMessage, setEditedMessage] = React.useState('');

    // Add useEffect to log and set the initial message
    React.useEffect(() => {
        console.log('Modal opened with initial message:', {
            initialMessage,
            isOpen
        });

        // Force set the message when modal opens
        if (isOpen) {
            setEditedMessage(initialMessage);
        }
    }, [isOpen, initialMessage]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(editedMessage);
    };

    return (
        <Modal
            additionalModalClassName="modal--medium"
            header={
                <ModalHeader>
                    Update Gift Message
                </ModalHeader>
            }
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            shouldShowCloseButton={true}
        >
            <LoadingOverlay isLoading={isLoading}>
                <form onSubmit={handleSubmit}>
                    <div className="form-field">
                        <label htmlFor="giftMessageInput" className="form-label">
                            Gift Message
                        </label>
                        <textarea
                            id="giftMessageInput"
                            className="form-input"
                            value={editedMessage}
                            onChange={(e) => setEditedMessage(e.target.value)}
                            rows={4}
                            placeholder="Enter your gift message"
                            style={{ resize: 'none' }}
                        />
                    </div>
                    <div className="form-actions">
                        <Button
                            onClick={onRequestClose}
                            variant={ButtonVariant.Secondary}
                        >
                            <TranslatedString id="common.cancel_action" />
                        </Button>
                        <Button
                            type="submit"
                            variant={ButtonVariant.Primary}
                            disabled={isLoading}
                        >
                            Submit
                        </Button>
                    </div>
                </form>
            </LoadingOverlay>
        </Modal>
    );
};

export default GiftMessageModal;