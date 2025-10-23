import { Country, FormField } from '@bigcommerce/checkout-sdk';
import { FormikProps, withFormik } from 'formik';
import React, { FunctionComponent } from 'react';
import { lazy } from 'yup';

import { TranslatedString, withLanguage, WithLanguageProps } from '@bigcommerce/checkout/locale';

import { Button, ButtonVariant } from '../ui/button';
import { Form } from '../ui/form';
import { LoadingOverlay } from '../ui/loading';
import { Modal, ModalHeader } from '../ui/modal';

import AddressForm from './AddressForm';
import getAddressFormFieldsValidationSchema from './getAddressFormFieldsValidationSchema';
import { AddressFormValues } from './mapAddressToFormValues';

export interface AddressFormModalProps extends AddressFormProps {
    isOpen: boolean;
    onAfterOpen?(): void;
}

export interface AddressFormProps {
    countries?: Country[];
    countriesWithAutocomplete: string[];
    googleMapsApiKey?: string;
    isLoading: boolean;
    shouldShowSaveAddress?: boolean;
    address?: any;
    defaultCountryCode?: string;
    isFloatingLabelEnabled?: boolean;
    getFields(countryCode?: string): FormField[];
    onSaveAddress(address: AddressFormValues): void;
    onRequestClose?(): void;
}

const SaveAddress: FunctionComponent<
    AddressFormProps & WithLanguageProps & FormikProps<AddressFormValues>
> = ({
    googleMapsApiKey,
    getFields,
    countriesWithAutocomplete,
    countries,
    values,
    setFieldValue,
    isLoading,
    onRequestClose,
    isFloatingLabelEnabled,
}) => (
        <Form autoComplete="on">
            <LoadingOverlay isLoading={isLoading}>
                <AddressForm
                    countries={countries}
                    countriesWithAutocomplete={countriesWithAutocomplete}
                    countryCode={values.countryCode}
                    formFields={getFields(values.countryCode)}
                    googleMapsApiKey={googleMapsApiKey}
                    isFloatingLabelEnabled={isFloatingLabelEnabled}
                    setFieldValue={setFieldValue}
                    shouldShowSaveAddress={false}
                />
                <div className="form-actions">
                    <Button
                        onClick={onRequestClose}
                        variant={ButtonVariant.Secondary}>
                        <TranslatedString id="common.cancel_action" />
                    </Button>


                    <Button
                        disabled={isLoading}
                        id="checkout-save-address"
                        type="submit"
                        variant={ButtonVariant.Primary}
                    >
                        <TranslatedString id="address.save_address_action" />
                    </Button>
                </div>
            </LoadingOverlay>
        </Form>
    );

const SaveAddressForm = withLanguage(
    withFormik<AddressFormProps & WithLanguageProps, AddressFormValues>({
        handleSubmit: (values, { props: { onSaveAddress } }) => {
            onSaveAddress(values);
        },
        mapPropsToValues: ({ defaultCountryCode = '', address }) => {
            const convertCustomFieldsToObject = (customFields: any) => {
                if (!customFields) return {};

                // If it's already an object, return as is
                if (!Array.isArray(customFields)) return customFields;

                // Convert array structure to object
                const customFieldsObj: { [key: string]: any } = {};

                customFields.forEach((field: any) => {
                    if (field.fieldId && field.fieldValue !== undefined) {
                        // Handle nested fieldValue structure
                        if (typeof field.fieldValue === 'object' && field.fieldValue.fieldId) {
                            customFieldsObj[field.fieldValue.fieldId] = field.fieldValue.fieldValue;
                        } else {
                            customFieldsObj[field.fieldId] = field.fieldValue;
                        }
                    }
                });

                return customFieldsObj;
            };
            if (address) {
                return {
                    firstName: address.firstName || '',
                    lastName: address.lastName || '',
                    address1: address.address1 || '',
                    address2: address.address2 || '',
                    customFields: convertCustomFieldsToObject(address.customFields),
                    country: address.country || '',
                    countryCode: address.countryCode || defaultCountryCode,
                    stateOrProvince: address.stateOrProvince || '',
                    stateOrProvinceCode: address.stateOrProvinceCode || '',
                    postalCode: address.postalCode || '',
                    phone: address.phone || '',
                    city: address.city || '',
                    company: address.company || '',
                    shouldSaveAddress: address.shouldSaveAddress || false,
                };
            }

            // Default values for new address
            return {
                firstName: '',
                lastName: '',
                address1: '',
                address2: '',
                customFields: {},
                country: '',
                countryCode: defaultCountryCode,
                stateOrProvince: '',
                stateOrProvinceCode: '',
                postalCode: '',
                phone: '',
                city: '',
                company: '',
                shouldSaveAddress: false,
            };
        },
        validationSchema: ({ language, getFields }: AddressFormProps & WithLanguageProps) =>
            lazy<Partial<AddressFormValues>>((values) => {
                // Get form fields based on country code
                const fields = getFields(values && values.countryCode);

                // Check if address type is Commercial (value "1")
                const isCommercial = values?.customFields?.field_26 == 1;

                // If Commercial, update the form fields to make company required
                const updatedFields = isCommercial
                    ? fields.map(field =>
                        field.name === 'company'
                            ? { ...field, required: true }
                            : field
                    )
                    : fields;

                // Return the validation schema with potentially updated fields
                return getAddressFormFieldsValidationSchema({
                    language,
                    formFields: updatedFields,
                });
            }),
    })(SaveAddress),
);

const AddressFormModal: FunctionComponent<AddressFormModalProps> = ({
    isOpen,
    onAfterOpen,
    onRequestClose,
    address,
    ...addressFormProps
}) => (
    <Modal
        additionalModalClassName="modal--medium"
        header={
            <ModalHeader>
                {address ? "Edit Address" : "Add Address"}
            </ModalHeader>
        }
        isOpen={isOpen}
        onAfterOpen={onAfterOpen}
        onRequestClose={onRequestClose}
        shouldShowCloseButton={true}
    >
        <SaveAddressForm {...addressFormProps} address={address} onRequestClose={onRequestClose} />
    </Modal>
);

export default AddressFormModal;
