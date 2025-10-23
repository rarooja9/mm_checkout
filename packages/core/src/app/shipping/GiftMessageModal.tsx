import React, { FunctionComponent, useState, useEffect } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { Modal, ModalHeader } from '../ui/modal';
import { LoadingOverlay } from '../ui/loading';
//import { TranslatedString } from '@bigcommerce/checkout/locale';

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
    const [editedMessage, setEditedMessage] = useState('');
    const [isApproved, setIsApproved] = useState(false);
    const [showSkipConfirmation, setShowSkipConfirmation] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const maxCharacterLimit = 300;

    // Add useEffect to log and set the initial message
    useEffect(() => {
        console.log('Modal opened with initial message:', {
            initialMessage,
            isOpen
        });
        // Force set the message when modal opens
        if (isOpen) {
            setEditedMessage(initialMessage);
            setError(null);
            setIsApproved(false);
        }
    }, [isOpen, initialMessage]);


    useEffect(() => {
        if (error) {
            const errorTimeout = setTimeout(() => {
                setError(null);
            }, 7000); // 7 seconds

            // Cleanup function to clear the timeout if component unmounts
            return () => clearTimeout(errorTimeout);
        }
    }, [error]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validate message is not empty
        if (!editedMessage || editedMessage.trim() === '') {
            setError('Please enter a gift message');
            return;
        }
        
        if (!isApproved) {
            setError('Please review and approve your gift message');
            return;
        }
        
        setError(null);
        onSubmit(editedMessage);
    };

    const handleSkipGiftMessage = () => {
        setShowSkipConfirmation(true);
    };

    const handleConfirmSkip = () => {
        // Call onSubmit with the placeholder value
        onSubmit('_');
        
        // Close the skip confirmation modal
        setShowSkipConfirmation(false);
    };

    const handleCancelSkip = () => {
        setShowSkipConfirmation(false);
    };

    const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const message = e.target.value;
        if (message.length <= maxCharacterLimit) {
            setEditedMessage(message);
            // Clear error when user starts typing
            if (error && error === 'Please enter a gift message') {
                setError(null);
            }
        }
    };

    const handleCheckboxChange = () => {
        setIsApproved(!isApproved);
        // Clear error when user checks the box
        if (error && error === 'Please review and approve your gift message') {
            setError(null);
        }
    }


    if (showSkipConfirmation) {
        return (
            <Modal
                additionalModalClassName="modal--medium gift-message-popup"
                header={
                    <ModalHeader>
                        Skip Gift Message
                    </ModalHeader>
                }
                isOpen={true}
                onRequestClose={() => setShowSkipConfirmation(false)}
                shouldShowCloseButton={true}
            >
                <LoadingOverlay isLoading={isLoading}>
                    <div>
                        <p>If I have not filled in the Gift Message and Signature lines, then a blank gift card will be enclosed with my order.</p>
                        <div className="form-actions">
                            <Button
                                onClick={handleCancelSkip}
                                variant={ButtonVariant.Secondary}
                                className="skip-gift-message-btn"
                            >
                                Add Gift Message
                            </Button>
                            <Button
                                onClick={handleConfirmSkip}
                                variant={ButtonVariant.Primary}
                            >
                                Confirm
                            </Button>
                        </div>
                    </div>
                </LoadingOverlay>
            </Modal>
        );
    }

    return (
        <Modal
            additionalModalClassName="modal--medium gift-message-popup"
            header={
                <ModalHeader>
                    Gift Message
                </ModalHeader>
            }
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            shouldShowCloseButton={true}
        >
            <LoadingOverlay isLoading={isLoading}>
                <form onSubmit={handleSubmit}>
                    <div className={`form-field ${error  ? 'form-field--error' : ''}`}>
                        <textarea
                            id="giftMessageInput"
                            className="form-input"
                            value={editedMessage}
                            onChange={handleMessageChange}
                            rows={4}
                            placeholder="Enter your gift message"
                            style={{ resize: 'none' }}
                            maxLength={maxCharacterLimit}
                        />
                        {error  && (
                            <div className="form-errorMessage">
                                {error }
                            </div>
                        )}
                        <div className="form-inlineMessage">
                            <b>___ Be sure to sign your gift message</b>
                            <span style={{ float: 'right' }}>
                                {editedMessage.length} / {maxCharacterLimit}
                            </span>
                        </div>
                    </div>
                    <div className="form-field">
                        <div className="custom-gift-msg-checkbox" style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                            <input
                                id="giftMessageApproval"
                                type="checkbox"
                                checked={isApproved}
                                onChange={handleCheckboxChange}
                                style={{ marginRight: '10px' }}
                            />
                            <label htmlFor="giftMessageApproval">
                                I have signed and reviewed my gift message and approve its content.
                            </label>
                        </div>
                    </div>
                    <div className="form-actions" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Button
                            onClick={handleSkipGiftMessage}
                            variant={ButtonVariant.Secondary}
                            className="skip-gift-message-btn"
                        >
                            Skip Gift Message
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